import type {SharedMsg} from "../../../../shared/types/msg";
import {toRaw} from "vue";
import {matchers} from "./matchers";

/**
 * Rewrites a bridged (shoutbox) message's sender and content via the first
 * matching bridge matcher.
 *
 * Never throws: nullish/malformed input returns the original message, and a
 * throwing matcher degrades to "no match". Matching itself is race-free:
 * matcher lookup is synchronous over a static list and the result is a fresh
 * shallow copy, so concurrent parses never share mutable state.
 *
 * @param originalMessage Message as received from the IRC bridge bot.
 * @returns Rewritten message copy, or `originalMessage` when no matcher applies.
 */
export function parser(originalMessage: SharedMsg) {
	if (!originalMessage || typeof originalMessage !== "object") {
		return originalMessage;
	}

	const originalSender = originalMessage.from?.nick?.toLowerCase();

	if (!originalMessage.text || !originalSender) {
		return originalMessage;
	}

	let edit: {nick?: string; content?: string} | undefined;

	try {
		const matcher = matchers.find((m) => {
			try {
				if (m.type === "basic") {
					return m.matches.includes(originalSender);
				}

				if (m.type === "advanced") {
					return m.matches(originalSender);
				}

				return false;
			} catch {
				return false;
			}
		});

		if (!matcher) {
			return originalMessage;
		}

		edit = matcher.transform(originalMessage);
	} catch {
		return originalMessage;
	}

	if (!edit || typeof edit.nick !== "string" || !edit.nick) {
		return originalMessage;
	}

	// Shallow copy on purpose: only text/from are replaced below, everything
	// else (previews, …) stays shared and read-only. A deep clone would need
	// structuredClone(), which throws on the reactive proxies messages carry
	// in the store (markMsgRaw) — and toRaw() only unwraps the top level.
	const raw = toRaw(originalMessage);
	const message: SharedMsg = {
		...raw,
		text: typeof edit.content === "string" ? edit.content : raw.text,
		from: {
			...raw.from!,
			nick: sanitizeNick(edit.nick),
			mode: "",
			shoutbox: true,
			original_nick: originalSender,
		},
	};

	return message;
}

/**
 * Strips characters that are invalid in IRC nicknames from a bridged sender.
 *
 * Never throws: non-string input yields an empty string.
 *
 * @param nick Raw bridged nick.
 * @returns Sanitized nick safe for display and mention matching.
 */
function sanitizeNick(nick: string) {
	if (typeof nick !== "string") {
		return "";
	}

	return nick.replaceAll(/[^0-9a-z_-|]/gi, "");
}
