// Create plain text entries corresponding to areas of the text that match no
// existing entries. Returns an empty array if all parts of the text have been
// parsed into recognizable entries already.
import {Part} from "./merge";

/**
 * Fills gaps between recognized parts with plain-text parts.
 *
 * Sorts a copy of the input (never mutating the caller's array) and clamps
 * offsets to the text bounds, so unsorted or out-of-range parser output
 * cannot produce overlapping or invalid filler parts.
 *
 * @param existingEntries Recognized parts with start/end offsets.
 * @param text Original plain text the parts refer to.
 * @returns Plain-text parts covering every unmatched area of the text.
 */
function fill(existingEntries: Part[], text: string) {
	if (!Array.isArray(existingEntries) || typeof text !== "string") {
		return [];
	}

	// Work on a sorted copy so callers' ordering is never mutated, and ignore
	// malformed entries instead of letting them corrupt the cursor.
	const sorted = [...existingEntries]
		.filter(
			(entry) =>
				entry &&
				typeof entry.start === "number" &&
				typeof entry.end === "number" &&
				entry.start >= 0 &&
				entry.end >= entry.start
		)
		.sort((a, b) => a.start - b.start || b.end - a.end);

	let position = 0;

	// Fill inner parts of the text. For example, if text is `foobarbaz` and both
	// `foo` and `baz` have matched into an entry, this will return a dummy entry
	// corresponding to `bar`.
	const result = sorted.reduce<Part[]>((acc, textSegment) => {
		const start = Math.min(Math.max(textSegment.start, position), text.length);
		const end = Math.min(Math.max(textSegment.end, start), text.length);

		if (start > position) {
			acc.push({
				start: position,
				end: start,
			});
		}

		position = Math.max(position, end);
		return acc;
	}, []);

	// Complete the unmatched end of the text with a dummy entry
	if (position < text.length) {
		result.push({
			start: position,
			end: text.length,
		});
	}

	return result;
}

export default fill;
