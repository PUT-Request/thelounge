import emojiRegExp from "emoji-regex";
import {Part} from "./merge";

const regExp = emojiRegExp();

export type EmojiPart = Part & {
	emoji: string;
};

/**
 * Finds all emoji in the given text.
 *
 * Resets the shared `emoji-regex` cursor before scanning so consecutive calls
 * cannot leak `lastIndex` state into each other (the module-level RegExp is
 * stateful because of its `g` flag).
 *
 * @param text Plain text to scan for emoji.
 * @returns Array of emoji parts with start/end offsets and the matched emoji.
 */
function findEmoji(text: string) {
	const result: EmojiPart[] = [];
	let match: RegExpExecArray | null;

	// The shared RegExp keeps `lastIndex` between `exec` calls. Reset it so a
	// previous scan (or one aborted by an exception) cannot shift this scan.
	regExp.lastIndex = 0;

	while ((match = regExp.exec(text))) {
		result.push({
			start: match.index,
			end: match.index + match[0].length,
			emoji: match[0],
		});
	}

	return result;
}

export default findEmoji;
