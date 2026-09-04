import {expect} from "vitest";
import express from "express";
import got from "got";
import type {AddressInfo} from "net";
import Uploader from "../../server/plugins/uploader";

// The uploader's slug route uses express 5 (path-to-regexp v8) syntax.
// These tests boot a minimal app with only Uploader.router registered and
// prove the routes match (with and without a slug, single- and
// multi-segment) instead of throwing at registration time. All uploads are
// missing, so every case must 404 through routeGetFile itself.
describe("Uploader routes", function () {
	let baseUrl: string;
	let server: import("http").Server;

	beforeAll(async function () {
		const app = express();
		Uploader.router(app);

		await new Promise<void>((resolve) => {
			server = app.listen(0, "127.0.0.1", () => resolve());
		});

		const port = (server.address() as AddressInfo).port;
		baseUrl = `http://127.0.0.1:${port}/`;
	});

	afterAll(async function () {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	for (const target of [
		"uploads/0123456789abcdef",
		"uploads/0123456789abcdef/file.png",
		"uploads/0123456789abcdef/a/b/c.png",
		"uploads/nothex",
		"uploads/nothex/file.png",
	]) {
		it(`serves a 404 for /${target}`, async function () {
			const response = await got(baseUrl + target, {throwHttpErrors: false});
			expect(response.statusCode).to.equal(404);
		});
	}
});
