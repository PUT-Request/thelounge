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
		store.commit("messageSearchResults", null);
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

	it("caps retained search results and stops automatic paging at the cap", function () {
		const query = {
			searchTerm: "needle",
			networkUuid: "network",
			channelName: "#channel",
			offset: 0,
		};
		store.commit("messageSearchResults", {
			results: Array.from({length: 950}, (_, id) => ({id})),
			query,
			scrollTop: 50,
			hasMore: true,
		});

		store.commit("addMessageSearchResults", {
			results: Array.from({length: 100}, (_, id) => ({id: 1000 + id})),
			query: {...query, offset: 100},
			scrollTop: 0,
			hasMore: true,
		});

		expect(store.state.messageSearchResults.results).to.have.lengthOf(1000);
		expect(store.state.messageSearchResults.hasMore).to.be.false;
		expect(store.state.messageSearchResults.scrollTop).to.equal(50);
	});
});
