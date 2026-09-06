// @vitest-environment jsdom
import {expect, vi} from "vitest";

// router.ts pulls .vue route components (with asset imports vitest cannot
// resolve); the menu generator only needs switchToChannel inside actions.
vi.mock("../../../client/js/router", () => ({
	switchToChannel() {},
}));

import {generateUserContextMenu} from "../../../client/js/helpers/contextMenu";
import {ChanType} from "../../../shared/types/chan";

function setup(
	users: any[] = [],
	channelExtra: any = {},
	settingsExtra: any = {},
	networkExtra: any = {}
) {
	const store = {
		state: {
			settings: {
				enhancedContextMenuEnabled: true,
				showUserIdentity: true,
				...settingsExtra,
			},
		},
		getters: {},
	} as any;
	const channel = {
		id: 1,
		name: "#chan",
		type: ChanType.CHANNEL,
		users,
		...channelExtra,
	} as any;
	const network = {
		nick: "me",
		channels: [],
		serverOptions: {},
		...networkExtra,
	} as any;

	return {store, channel, network};
}

describe("generateUserContextMenu", function () {
	it("shows tracked account and host as info rows", function () {
		const {store, channel, network} = setup([
			{nick: "bob", modes: [], account: "bob-acc", ident: "~bob", hostname: "host.example"},
		]);

		const items = generateUserContextMenu(store, channel, network, {nick: "bob", modes: []});
		const info = items.filter((i) => i.type === "info");

		expect(info.map((i: any) => i.label)).to.deep.equal([
			"Logged in as bob-acc",
			"~bob@host.example",
		]);
		// Info rows sit right under the nick header
		expect(items[0]).to.include({label: "bob"});
		expect(items[1]).to.include({type: "info"});
	});

	it("omits info rows when nothing is tracked", function () {
		const {store, channel, network} = setup([{nick: "carol", modes: []}]);

		const items = generateUserContextMenu(store, channel, network, {nick: "carol", modes: []});

		expect(items.some((i) => i.type === "info")).to.be.false;
		expect(items[0]).to.include({label: "carol"});
	});

	it("shows hostname without ident", function () {
		const {store, channel, network} = setup([{nick: "dave", modes: [], hostname: "h.example"}]);

		const items = generateUserContextMenu(store, channel, network, {nick: "dave", modes: []});
		const info = items.filter((i) => i.type === "info");

		expect(info.map((i: any) => i.label)).to.deep.equal(["h.example"]);
	});

	it("hides identity rows when showUserIdentity is off", function () {
		const {store, channel, network} = setup(
			[{nick: "bob", modes: [], account: "bob-acc", hostname: "host.example"}],
			{},
			{showUserIdentity: false}
		);

		const items = generateUserContextMenu(store, channel, network, {nick: "bob", modes: []});

		expect(items.some((i) => i.type === "info")).to.be.false;
	});

	it("falls back to a classic menu when enhanced menu is off", function () {
		const torrentSite = {profileUrl: "https://tracker.example/users/", disabled: false};
		const {store, channel, network} = setup(
			[{nick: "bob", modes: [], account: "bob-acc", hostname: "host.example"}],
			{torrentSite},
			{enhancedContextMenuEnabled: false}
		);

		const items = generateUserContextMenu(store, channel, network, {nick: "bob", modes: []});

		expect(items.some((i) => i.type === "info")).to.be.false;
		expect(items.some((i: any) => i.label === "Tracker Profile")).to.be.false;
	});

	it("shows tracker profile when enhanced menu is on", function () {
		const torrentSite = {profileUrl: "https://tracker.example/users/", disabled: false};
		const {store, channel, network} = setup([{nick: "bob", modes: []}], {torrentSite});

		const items = generateUserContextMenu(store, channel, network, {nick: "bob", modes: []});
		const tracker = items.find((i: any) => i.label === "Tracker Profile") as any;

		expect(tracker).to.exist;
		expect(tracker.class).to.equal("action-open");
	});
});
