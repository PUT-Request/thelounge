/**
 * Computes the Euclidean distance between two 2D points.
 *
 * Returns `0` for malformed input instead of throwing (`NaN` would otherwise
 * propagate into swipe-gesture thresholds).
 *
 * @param a First point as `[x, y]`.
 * @param b Second point as `[x, y]`.
 * @returns Euclidean distance, or `0` when the inputs are invalid.
 */
function distance([x1, y1]: [number, number], [x2, y2]: [number, number]) {
	if (
		typeof x1 !== "number" ||
		typeof y1 !== "number" ||
		typeof x2 !== "number" ||
		typeof y2 !== "number" ||
		!Number.isFinite(x1) ||
		!Number.isFinite(y1) ||
		!Number.isFinite(x2) ||
		!Number.isFinite(y2)
	) {
		return 0;
	}

	return Math.hypot(x1 - x2, y1 - y2);
}

export default distance;
