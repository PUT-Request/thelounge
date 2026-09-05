import {Part} from "./merge";

const nickRegExp = /([\p{Letter}\p{Number}_[\]\\`^{|}-]+)/gu;

export type NamePart = Part & {
	nick: string;
};

/**
 * Finds known nicknames inside a message text.
 *
 * Resets the shared nickname RegExp cursor before scanning so consecutive
 * calls cannot leak `lastIndex` state into each other, and guards the inputs
 * so unexpected values return an empty result instead of throwing.
 *
 * @param text Plain message text to search.
 * @param nicks Nicknames to look for.
 * @returns Array of nick parts with start/end offsets and the matched nick.
 */
function findNames(text: string, nicks: string[]): NamePart[] {
	const result: NamePart[] = [];

	// Return early if we don't have any nicknames to find
	if (!Array.isArray(nicks) || nicks.length === 0 || typeof text !== "string") {
		return result;
	}

	let match: RegExpExecArray | null;

	// The module-level RegExp is stateful (`g` flag); reset it so a previous
	// scan cannot shift this one.
	nickRegExp.lastIndex = 0;

	while ((match = nickRegExp.exec(text))) {
		if (nicks.indexOf(match[1]) > -1) {
			result.push({
				start: match.index,
				end: match.index + match[1].length,
				nick: match[1],
			});
		}
	}

	return result;
}

export default findNames;
