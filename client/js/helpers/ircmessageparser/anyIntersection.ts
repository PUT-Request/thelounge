// Return true if any section of "a" or "b" parts (defined by their start/end
// markers) intersect each other, false otherwise.
import {Part} from "./merge";

/**
 * Checks whether two text parts overlap.
 *
 * Treats missing or non-numeric offsets as non-intersecting instead of
 * throwing, so malformed parser output can never crash message rendering.
 *
 * @param a First part with start/end offsets.
 * @param b Second part with start/end offsets.
 * @returns True when the parts intersect, false otherwise.
 */
function anyIntersection(a: Part, b: Part) {
	if (
		!a ||
		!b ||
		typeof a.start !== "number" ||
		typeof a.end !== "number" ||
		typeof b.start !== "number" ||
		typeof b.end !== "number"
	) {
		return false;
	}

	return (
		(a.start <= b.start && b.start < a.end) ||
		(a.start < b.end && b.end <= a.end) ||
		(b.start <= a.start && a.start < b.end) ||
		(b.start < a.end && a.end <= b.end)
	);
}

export default anyIntersection;
