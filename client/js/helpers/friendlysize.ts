const sizes = ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB"];

/**
 * Formats a byte count as a human-readable size (e.g. `1.2 MiB`).
 *
 * Returns `0 Bytes` for non-finite or non-positive input instead of throwing,
 * and clamps the unit index so extremely large values stay within `sizes`.
 *
 * @param size Size in bytes.
 * @returns Human-readable size string.
 */
export default (size: number) => {
	// Loosely inspired from https://stackoverflow.com/a/18650828/1935861
	if (!Number.isFinite(size) || size <= 0) {
		return "0 Bytes";
	}

	const i = Math.min(Math.floor(Math.log(size) / Math.log(1024)), sizes.length - 1);
	const fixedSize = parseFloat((size / Math.pow(1024, i)).toFixed(1));
	return `${fixedSize} ${sizes[i]}`;
};
