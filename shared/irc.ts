const matchFormatting =
	/\x02|\x1D|\x1F|\x16|\x0F|\x11|\x1E|\x03(?:[0-9]{1,2}(?:,[0-9]{1,2})?)?|\x04(?:[0-9a-f]{6}(?:,[0-9a-f]{6})?)?/gi;

/**
 * Strips IRC formatting control codes from a message and trims it.
 *
 * Never throws: non-string input yields an empty string instead of a
 * `TypeError`, so unexpected payloads cannot crash rendering.
 *
 * @param message Raw IRC message possibly containing formatting codes.
 * @returns Clean plain-text message.
 */
export function cleanIrcMessage(message: string) {
	if (typeof message !== "string") {
		return "";
	}

	try {
		return message.replace(matchFormatting, "").trim();
	} catch {
		return "";
	}
}

/**
 * Normalizes an IRCv3 account value to a services account name.
 *
 * Normalize an IRCv3 account value: `false` (logged out), `"*"`, and `""`
 * all mean "no account". Anything else is a services account name.
 *
 * Never throws on unexpected shapes (objects, numbers, ...): they map to
 * `undefined` ("no account").
 *
 * @param account Raw `account` tag value from the IRC message.
 * @returns Account name, or `undefined` when logged out / absent.
 */
export function normalizeAccountName(account: unknown): string | undefined {
	return typeof account === "string" && account !== "" && account !== "*" ? account : undefined;
}

export type IrcCaseMapping = "ascii" | "strict-rfc1459" | "rfc1459";

export function ircCasefold(value: string, mapping: string = "rfc1459"): string {
	const lowered = value.toLowerCase();

	if (mapping === "ascii") {
		return lowered;
	}

	const strict = lowered.replaceAll("[", "{").replaceAll("]", "}").replaceAll("\\", "|");

	return mapping === "strict-rfc1459" ? strict : strict.replace(/\^/g, "~");
}

export const condensedTypes = new Set([
	"away",
	"back",
	"chghost",
	"join",
	"kick",
	"mass_event",
	"mode",
	"nick",
	"part",
	"quit",
]);
