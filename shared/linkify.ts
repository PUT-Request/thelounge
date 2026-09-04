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
			return self.testSchemaAt(`http:${text.slice(pos)}`, "http:", "http:".length);
		},
	});
}

linkify.add("web+", {
	validate(text: string, pos: number, self: LinkifyIt) {
		const webSchemaRe = /^[a-z]+:/gi;

		if (!webSchemaRe.test(text.slice(pos))) {
			return 0;
		}

		const linkEnd = self.testSchemaAt(text, "http:", pos + webSchemaRe.lastIndex);

		if (linkEnd === 0) {
			return 0;
		}

		return webSchemaRe.lastIndex + linkEnd;
	},
	normalize(match) {
		match.schema = match.text.slice(0, match.text.indexOf(":") + 1);
	},
});

export function findLinks(text: string) {
	const matches = linkify.match(text);

	if (!matches) {
		return [];
	}

	return matches.map(makeLinkPart);
}

export function findLinksWithSchema(text: string) {
	const matches = linkify.match(text);

	if (!matches) {
		return [];
	}

	return matches.filter((url) => !!url.schema).map(makeLinkPart);
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
