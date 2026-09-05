const matchFormatting =
	/\x02|\x1D|\x1F|\x16|\x0F|\x11|\x1E|\x03(?:[0-9]{1,2}(?:,[0-9]{1,2})?)?|\x04(?:[0-9a-f]{6}(?:,[0-9a-f]{6})?)?/gi;

export function cleanIrcMessage(message: string) {
	return message.replace(matchFormatting, "").trim();
}

// Normalize an IRCv3 account value: `false` (logged out), `"*"`, and `""`
// all mean "no account". Anything else is a services account name.
export function normalizeAccountName(account: unknown): string | undefined {
	return typeof account === "string" && account !== "" && account !== "*" ? account : undefined;
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
