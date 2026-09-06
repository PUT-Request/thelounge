import {expect} from "vitest";
import {validatePushEndpoint} from "../../server/plugins/webpush";

describe("WebPush endpoint validation", function () {
	it("rejects non-HTTPS and credential-bearing endpoints", async function () {
		expect(await validatePushEndpoint("http://8.8.8.8/push")).to.be.false;
		expect(await validatePushEndpoint("https://user:pass@8.8.8.8/push")).to.be.false;
	});

	it("rejects local and private IP destinations", async function () {
		expect(await validatePushEndpoint("https://127.0.0.1/push")).to.be.false;
		expect(await validatePushEndpoint("https://10.1.2.3/push")).to.be.false;
		expect(await validatePushEndpoint("https://[::1]/push")).to.be.false;
		expect(await validatePushEndpoint("https://[fc00::1]/push")).to.be.false;
	});

	it("accepts a public HTTPS IP endpoint", async function () {
		expect(await validatePushEndpoint("https://8.8.8.8/push")).to.be.true;
	});
});
