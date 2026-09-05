/**
 * Maps an arbitrary string to a stable nick color class (`color-1`..`color-32`).
 *
 * Never throws: nullish input is treated as an empty string.
 *
 * @param str Input string (usually a nickname).
 * @returns Color class name, e.g. `"color-7"`.
 */
export default (str: string) => {
	const input = str ?? "";
	let hash = 0;

	for (let i = 0; i < input.length; i++) {
		hash += input.charCodeAt(i);
	}

	/*
		Modulo 32 lets us be case insensitive for ascii
		due to A being ascii 65 (100 0001)
		 while a being ascii 97 (110 0001)
	*/
	return "color-" + (1 + (hash % 32)).toString();
};
