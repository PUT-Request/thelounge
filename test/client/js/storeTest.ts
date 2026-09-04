// @vitest-environment jsdom
import {expect} from "vitest";

describe("authFailure state", function () {
	let store: any;
	let storage: any;

	beforeAll(async function () {
		// client/js/socket.ts reads this at import time; without it the
		// store module cannot be imported outside a real page.
		document.body.dataset.transports = '["websocket"]';
		store = (await import("../../../client/js/store")).store;
		storage = (await import("../../../client/js/localStorage")).default;
	});

	afterEach(function () {
		store.commit("authFailure", null);
	});

	it("persists failures to local storage and clears them", function () {
		expect(store.state.authFailure).to.be.null;

		store.commit("authFailure", "failed");
		expect(store.state.authFailure).to.equal("failed");
		expect(storage.get("thelounge.state.authFailure")).to.equal("failed");

		store.commit("authFailure", "disconnected");
		expect(store.state.authFailure).to.equal("disconnected");

		store.commit("authFailure", null);
		expect(store.state.authFailure).to.be.null;
		expect(storage.get("thelounge.state.authFailure")).to.be.null;
	});
});
