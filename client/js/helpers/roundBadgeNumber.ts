/**
 * Formats a badge count, abbreviating thousands with a `k` suffix.
 *
 * Non-finite or negative input is treated as `0` instead of throwing, so
 * badge rendering can never crash on unexpected counts.
 *
 * @param count Badge count.
 * @returns Count as a string, e.g. `"123"` or `"1.2k"`.
 */
export default (count: number) => {
	if (!Number.isFinite(count) || count < 0) {
		return "0";
	}

	if (count < 1000) {
		return count.toString();
	}

	return (count / 1000).toFixed(2).slice(0, -1) + "k";
};
