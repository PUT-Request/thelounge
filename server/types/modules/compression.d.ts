// Local declaration instead of @types/compression: that package depends on
// `@types/express: *`, which currently resolves to the express 5 types and
// conflicts with this repo's express 4 handler types.
declare module "compression" {
	import type {RequestHandler} from "express";

	function compression(options?: {
		threshold?: number | string | ((req: any, res: any) => boolean);
	}): RequestHandler;

	export default compression;
}
