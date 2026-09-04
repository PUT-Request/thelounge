// Local declaration because file-type v22+ only exposes types through the
// package exports map, which this repo's node10 module resolution does not
// read (same reason as compression.d.ts). Mirrors the real signatures.
declare module "file-type" {
	export type FileTypeResult = {
		ext: string;
		mime: string;
	};

	export function fileTypeFromBuffer(
		buffer: Uint8Array | ArrayBuffer,
		options?: Record<string, unknown>
	): Promise<FileTypeResult | undefined>;
}
