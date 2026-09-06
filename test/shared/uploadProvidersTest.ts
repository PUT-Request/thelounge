import {expect, vi} from "vitest";

import {UploadProviders} from "../../shared/upload-providers";

describe("external upload providers", function () {
	const file = new File(["test"], "test.txt", {type: "text/plain"});

	it("requires API credentials before contacting token-protected providers", async function () {
		const provider = UploadProviders.find(({id}) => id === "imagebb")!;

		await expect(provider.upload(file, "forever")).rejects.toThrow(
			"API token is required for ImageBB uploads"
		);
	});

	it("sends XBackBone credentials in the body and refuses redirects", async function () {
		const provider = UploadProviders.find(({id}) => id === "xbackbone")!;
		const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.redirect).to.equal("error");
			expect(init?.body).to.be.instanceOf(FormData);
			expect((init?.body as FormData).get("token")).to.equal("provider-secret");
			return Promise.resolve(
				new Response(JSON.stringify({raw_url: "https://cdn.example/file.txt"}), {
					status: 200,
					headers: {"content-type": "application/json"},
				})
			);
		});

		const result = await provider.upload(
			file,
			"",
			"provider-secret",
			undefined,
			"https://uploads.example/api/upload",
			request
		);

		expect(result).to.equal("https://cdn.example/file.txt");
		expect(request).toHaveBeenCalledOnce();
	});

	it("caps provider response bodies", async function () {
		const provider = UploadProviders.find(({id}) => id === "xbackbone")!;
		const request = vi.fn(() =>
			Promise.resolve(
				new Response("{}", {
					status: 200,
					headers: {"content-length": String(1024 * 1024 + 1)},
				})
			)
		);

		await expect(
			provider.upload(
				file,
				"",
				"provider-secret",
				undefined,
				"https://uploads.example/api/upload",
				request
			)
		).rejects.toThrow("Upload provider response is too large");
	});
});
