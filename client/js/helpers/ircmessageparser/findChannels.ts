// Escapes the RegExp special characters "^", "$", "", ".", "*", "+", "?", "(",
// ")", "[", "]", "{", "}", and "|" in string.
// See https://lodash.com/docs/#escapeRegExp
import escapeRegExp from "lodash/escapeRegExp";
import {Part} from "./merge";

export type ChannelPart = Part & {
	channel: string;
};

// escapes a regex in a way that's compatible to shove it in
// a regex char set (meaning it also escapes -)
function escapeRegExpCharSet(raw: string): string {
	const escaped: string = escapeRegExp(raw);
	return escaped.replace("-", "\\-");
}

/**
 * Extracts channel names from a plain-text message.
 *
 * Builds a fresh local RegExp per call (instead of sharing a stateful one) so
 * concurrent/sequential calls cannot leak `lastIndex` state into each other,
 * and returns an empty list for non-string input instead of throwing.
 *
 * @param text Plain message text to search.
 * @param channelPrefixes Valid channel prefixes (e.g. `#`, `&`).
 * @param userModes User mode symbols to ignore (e.g. `@`, `+`).
 * @returns Array of channel parts with start/end offsets and channel names.
 */
function findChannels(text: string, channelPrefixes: string[], userModes: string[]) {
	if (typeof text !== "string" || !Array.isArray(channelPrefixes) || !Array.isArray(userModes)) {
		return [];
	}

	// `userModePattern` is necessary to ignore user modes in /whois responses.
	// For example, a voiced user in #thelounge will have a /whois response of:
	// > foo is on the following channels: +#thelounge
	// We need to explicitly ignore user modes to parse such channels correctly.
	const userModePattern = userModes.map(escapeRegExpCharSet).join("");
	const channelPrefixPattern = channelPrefixes.map(escapeRegExpCharSet).join("");
	const channelPattern = `(?:^|\\s)[${userModePattern}]*([${channelPrefixPattern}][^ \u0007]+)`;
	const channelRegExp = new RegExp(channelPattern, "g");

	const result: ChannelPart[] = [];
	let match: RegExpExecArray | null;

	do {
		// With global ("g") regexes, calling `exec` multiple times will find
		// successive matches in the same string.
		match = channelRegExp.exec(text);

		if (match) {
			result.push({
				start: match.index + match[0].length - match[1].length,
				end: match.index + match[0].length,
				channel: match[1],
			});
		}
	} while (match);

	return result;
}

export default findChannels;
