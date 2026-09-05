import dayjs from "dayjs";

/**
 * Formats a timestamp as a local-time string (`D MMMM YYYY, HH:mm:ss`).
 *
 * Returns an empty string for invalid input instead of `"Invalid Date"`, so
 * broken timestamps never leak into the UI.
 *
 * @param time Date object or epoch milliseconds.
 * @returns Formatted local-time string, or `""` when invalid.
 */
export default (time: Date | number) => {
	try {
		const date = dayjs(time);

		if (!date.isValid()) {
			return "";
		}

		return date.format("D MMMM YYYY, HH:mm:ss");
	} catch {
		return "";
	}
};
