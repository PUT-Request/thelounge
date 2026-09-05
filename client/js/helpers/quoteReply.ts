// Quote-style replies: paste an IRC-formatted quote of a message into the
// input box. This is independent of IRCv3 protocol replies and works on any
// network, including ones without +reply support.
/**
 * Formats an IRC-styled quote reply (`<nick>: "first line"`) for the input box.
 *
 * Only the first non-empty line (truncated to 200 chars) is quoted, and raw
 * CR/LF characters are stripped from it so a multi-line or control-code-heavy
 * message cannot break the input layout. Returns `null` when there is nothing
 * quotable instead of throwing.
 *
 * @param nick Nickname being quoted.
 * @param text Original message text.
 * @returns IRC-formatted quote string, or `null` when inputs are empty.
 */
export function formatQuoteReply(nick: string, text: string): string | null {
	if (typeof nick !== "string" || typeof text !== "string" || !nick || !text) {
		return null;
	}

	const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
	const content = firstLine.replace(/[\r\n]/g, "").substring(0, 200);

	if (!content) {
		return null;
	}

	return `\x02${nick}\x02: \x0314,99"\x1D${content}\x1D"\x03`;
}
