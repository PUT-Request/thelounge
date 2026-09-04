// Local declaration because chalk v6+ only exposes types through the
// package exports map, which this repo's node10 module resolution does not
// read (same reason as compression.d.ts / file-type.d.ts). Covers exactly
// the color functions used across server/ and scripts/, including chaining.
declare module "chalk" {
	interface ChalkInstance {
		(text: string): string;
		blue: ChalkInstance;
		bold: ChalkInstance;
		cyan: ChalkInstance;
		dim: ChalkInstance;
		gray: ChalkInstance;
		green: ChalkInstance;
		red: ChalkInstance;
		yellow: ChalkInstance;
	}

	const chalk: ChalkInstance;

	export default chalk;
}
