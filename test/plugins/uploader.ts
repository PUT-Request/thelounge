import {expect, vi} from "vitest";
import express from "express";
import got from "got";
import fs from "fs";
import type {AddressInfo} from "net";
import Uploader from "../../server/plugins/uploader";
import Config from "../../server/config";
import {UploadProviders} from "../../shared/upload-providers";

function issueUploadAuthorization(service: string) {
	const handlers = new Map<string, (...args: any[]) => void>();
	let token: string | undefined;
	const socket = {
		on(event: string, handler: (...args: any[]) => void) {
			handlers.set(event, handler);
		},
		once(event: string, handler: (...args: any[]) => void) {
			handlers.set(event, handler);
		},
		emit(event: string, data: string) {
			if (event === "upload:auth") {
				token = data;
			}
		},
	};

	new Uploader(socket as any);
	handlers.get("upload:auth")?.({service});

	if (!token) {
		throw new Error("Uploader did not issue an authorization");
	}

	return {token, service};
}

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

	it("rejects an external upload without a single-use authorization", async function () {
		const response = await got.post(baseUrl + "uploads/catbox/unused", {
			throwHttpErrors: false,
			headers: {"content-type": "multipart/form-data; boundary=unused"},
			body: "--unused--\r\n",
		});

		expect(response.statusCode).to.equal(401);
		expect(JSON.parse(response.body).error).to.equal("Invalid upload token");
	});

	it("binds a single-use authorization to its selected provider", async function () {
		const authorization = issueUploadAuthorization("catbox");
		const response = await got.post(baseUrl + `uploads/new/${authorization.token}`, {
			throwHttpErrors: false,
			headers: {"content-type": "multipart/form-data; boundary=unused"},
			body: "--unused--\r\n",
		});

		expect(response.statusCode).to.equal(401);
		expect(JSON.parse(response.body).error).to.equal("Invalid upload token");
	});

	it("does not create an upload artifact when authorized multipart data has no file", async function () {
		const uploadPath = Config.getFileUploadPath();
		const before = fs.existsSync(uploadPath) ? fs.readdirSync(uploadPath).sort() : [];
		const boundary = "thelounge-missing-file-test";
		const authorization = issueUploadAuthorization("catbox");
		const response = await got.post(baseUrl + `uploads/catbox/${authorization.token}`, {
			throwHttpErrors: false,
			headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
			body: `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n--${boundary}--\r\n`,
		});

		expect(response.statusCode).to.equal(400);
		expect(JSON.parse(response.body).error).to.equal("Missing file");
		const after = fs.existsSync(uploadPath) ? fs.readdirSync(uploadPath).sort() : [];
		expect(after).to.deep.equal(before);
	});

	it("requires an administrator-allowed public HTTPS origin for XBackBone", async function () {
		const previousOrigins = Config.values.fileUpload.externalUploadOrigins;

		try {
			Config.values.fileUpload.externalUploadOrigins = ["https://127.0.0.1"];
			await expect(
				Uploader.validateExternalUploadDestination("https://127.0.0.1/upload")
			).rejects.toThrow("Private network destinations are not allowed");

			Config.values.fileUpload.externalUploadOrigins = [];
			await expect(
				Uploader.validateExternalUploadDestination("https://uploads.example/upload")
			).rejects.toThrow("not allowed by the server administrator");
		} finally {
			Config.values.fileUpload.externalUploadOrigins = previousOrigins;
		}
	});

	it("keeps provider credentials out of the URL and consumes authorization once", async function () {
		const provider = UploadProviders.find(({id}) => id === "imagebb")!;
		const originalUpload = provider.upload;
		const upload = vi.fn(() => Promise.resolve("https://cdn.example/file.txt"));
		provider.upload = upload;

		try {
			const authorization = issueUploadAuthorization("imagebb");
			const boundary = "thelounge-external-upload-test";
			const body = [
				`--${boundary}`,
				'Content-Disposition: form-data; name="providerToken"',
				"",
				"provider-secret",
				`--${boundary}`,
				'Content-Disposition: form-data; name="file"; filename="test.txt"',
				"Content-Type: text/plain",
				"",
				"test",
				`--${boundary}--`,
				"",
			].join("\r\n");
			const target = `uploads/imagebb/${authorization.token}/forever`;
			const response = await got.post(baseUrl + target, {
				throwHttpErrors: false,
				headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
				body,
			});

			expect(response.statusCode).to.equal(200);
			expect(JSON.parse(response.body).url).to.equal("https://cdn.example/file.txt");
			expect(target).not.to.contain("provider-secret");
			expect(upload).toHaveBeenCalledOnce();
			expect(upload.mock.calls[0][2]).to.equal("provider-secret");

			const replay = await got.post(baseUrl + target, {
				throwHttpErrors: false,
				headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
				body,
			});
			expect(replay.statusCode).to.equal(401);
		} finally {
			provider.upload = originalUpload;
		}
	});
});
