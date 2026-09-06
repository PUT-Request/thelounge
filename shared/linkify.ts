import {LinkifyIt, Match} from "linkify-it";
import tlds from "tlds";

export type LinkPart = {
	start: number;
	end: number;
	link: string;
};

// v6 changed defaults: fuzzyLink and urlAuth are now off. This codebase
// relies on the v5 behavior (bare domains linkify, user:pass@ URLs keep
// working), so opt back into both explicitly.
const linkify = new LinkifyIt({fuzzyLink: true, urlAuth: true}).tlds(tlds).tlds("onion", true);

// Known schemes to detect in text
const commonSchemes = [
	"sftp",
	"smb",
	"file",
	"irc",
	"ircs",
	"svn",
	"git",
	"steam",
	"mumble",
	"ts3server",
	"svn+ssh",
	"ssh",
	"gopher",
	"gemini",
];

for (const schema of commonSchemes) {
	// v6 removed string schema aliases ("http:"). Reuse the http tail
	// grammar instead: validate the text after our prefix as if it followed
	// "http:". testSchemaAt returns the tail length (0 on no match), which
	// is exactly what validate must return.
	linkify.add(schema + ":", {
		validate(text, pos, self) {
			try {
				return self.testSchemaAt(`http:${text.slice(pos)}`, "http:", "http:".length);
			} catch {
				return 0;
			}
		},
	});
}

linkify.add("web+", {
	validate(text: string, pos: number, self: LinkifyIt) {
		try {
			const webSchemaRe = /^[a-z]+:/gi;
			webSchemaRe.lastIndex = 0;

			if (!webSchemaRe.test(text.slice(pos))) {
				return 0;
			}

			const linkEnd = self.testSchemaAt(text, "http:", pos + webSchemaRe.lastIndex);

			if (linkEnd === 0) {
				return 0;
			}

			return webSchemaRe.lastIndex + linkEnd;
		} catch {
			return 0;
		}
	},
	normalize(match) {
		try {
			match.schema = match.text.slice(0, match.text.indexOf(":") + 1);
		} catch {
			// keep linkify's default schema on unexpected input
		}
	},
});

/**
 * Finds linkified URLs inside plain text.
 *
 * Never throws: non-string input yields an empty list, and unexpected
 * linkify errors degrade to `[]` so one bad message cannot break rendering.
 *
 * @param text Plain text to scan.
 * @returns Link parts with start/end offsets and resolved URLs.
 */
export function findLinks(text: string) {
	if (typeof text !== "string" || text.length === 0) {
		return [];
	}

	try {
		const matches = linkify.match(text);

		if (!matches) {
			return [];
		}

		return matches.map(makeLinkPart);
	} catch {
		return [];
	}
}

/**
 * Finds linkified URLs that carry an explicit scheme (`irc://`, `https://`, ...).
 *
 * Shares the error handling of {@link findLinks}: invalid input yields `[]`.
 *
 * @param text Plain text to scan.
 * @returns Link parts that include a URL scheme.
 */
export function findLinksWithSchema(text: string) {
	if (typeof text !== "string" || text.length === 0) {
		return [];
	}

	try {
		const matches = linkify.match(text);

		if (!matches) {
			return [];
		}

		return matches.filter((url) => !!url.schema).map(makeLinkPart);
	} catch {
		return [];
	}
}

function makeLinkPart(url: Match): LinkPart {
	let link = url.url;

	// we must rewrite protocol less urls to http, else if TL is hosted
	// on https, this would incorrectly use https for the remote link.
	// See https://github.com/thelounge/thelounge/issues/2525
	if (link.startsWith("//")) {
		link = "http:" + link;
	}

	return {
		start: url.index,
		end: url.lastIndex,
		link,
	};
}
