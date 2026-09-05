import type {SharedMsg} from "../../../../shared/types/msg";
import {toRaw} from "vue";
import {matchers} from "./matchers";

/**
 * Parse message aganst `Matchers` and edit the Nick and Content based on `transform` results
 */
export function parser(originalMessage: SharedMsg) {
	const originalSender = originalMessage.from?.nick?.toLowerCase();

	if (!originalMessage.text || !originalSender) return originalMessage;

	const matcher = matchers.find((m) => {
		if (m.type === "basic") return m.matches.includes(originalSender);
		if (m.type === "advanced") return m.matches(originalSender);
	});

	if (!matcher) return originalMessage;

	const edit = matcher.transform(originalMessage);
	if (!edit || !edit.nick) return originalMessage;

	// Shallow copy on purpose: only text/from are replaced below, everything
	// else (previews, …) stays shared and read-only. A deep clone would need
	// structuredClone(), which throws on the reactive proxies messages carry
	// in the store (markMsgRaw) — and toRaw() only unwraps the top level.
	const raw = toRaw(originalMessage);
	const message: SharedMsg = {
		...raw,
		text: edit.content ?? raw.text,
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
 * Helper to remove invalid chars from nick string
 */
function sanitizeNick(nick: string) {
	return nick.replaceAll(/[^0-9a-z_-|]/gi, "");
}
