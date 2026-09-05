// @vitest-environment jsdom
import {expect, vi} from "vitest";

// router.ts pulls .vue route components (with asset imports vitest cannot
// resolve); the menu generator only needs switchToChannel inside actions.
vi.mock("../../../client/js/router", () => ({
	switchToChannel() {},
}));

import {generateUserContextMenu} from "../../../client/js/helpers/contextMenu";
import {ChanType} from "../../../shared/types/chan";

function setup(users: any[] = [], channelExtra: any = {}) {
	const store = {} as any;
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
});
