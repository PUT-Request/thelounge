import {expect} from "vitest";

import {isPublicNetworkAddress, resolvePublicHostname} from "../../server/publicNetwork";

describe("public outbound network policy", function () {
	it("blocks private, loopback, link-local, documentation, and mapped addresses", function () {
		for (const [address, family] of [
			["127.0.0.1", 4],
			["10.0.0.1", 4],
			["169.254.169.254", 4],
			["192.168.1.1", 4],
			["192.0.2.1", 4],
			["::1", 6],
			["fc00::1", 6],
			["fe80::1", 6],
			["2001:db8::1", 6],
			["::ffff:127.0.0.1", 6],
		] as const) {
			expect(isPublicNetworkAddress(address, family), address).to.be.false;
		}
	});

	it("rejects localhost before an outbound request", async function () {
		await expect(resolvePublicHostname("localhost")).rejects.toThrow(
			"Private network destinations are not allowed"
		);
	});
});
