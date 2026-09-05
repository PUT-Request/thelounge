// Quote-style replies: paste an IRC-formatted quote of a message into the
// input box. This is independent of IRCv3 protocol replies and works on any
// network, including ones without +reply support.
export function formatQuoteReply(nick: string, text: string): string | null {
	if (!nick || !text) {
		return null;
	}

	const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
	const content = firstLine.substring(0, 200);

	if (!content) {
		return null;
	}

	return `\x02${nick}\x02: \x0314,99"\x1D${content}\x1D"\x03`;
}
