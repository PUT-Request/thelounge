import {expect} from "vitest";
import {ChanType} from "../../../shared/types/chan";
import {buildPaletteItems, filterPaletteItems, PaletteItem} from "../../../client/js/palette";

function channel(id: number, name: string, type: string = ChanType.CHANNEL, unread = 0) {
	return {id, name, type, unread} as any;
}

function source() {
	return {
		networks: [
			{
				name: "Libera",
				channels: [channel(1, "#lounge"), channel(2, "#general", ChanType.CHANNEL, 3)],
			},
			{
				name: "OFTC",
				channels: [channel(3, "#lounge")],
			},
		],
		commands: ["/join", "/msg", "/search"],
	};
}

describe("palette items", function () {
	it("builds channels, commands, and navigation entries", function () {
		const items = buildPaletteItems(source() as any);

		expect(items.filter((i) => i.kind === "channel").map((i) => i.title)).to.deep.equal([
			"#lounge",
			"#general",
			"#lounge",
		]);
		expect(items.filter((i) => i.kind === "command").map((i) => i.title)).to.deep.equal([
			"/join",
			"/msg",
			"/search",
		]);
		expect(items.some((i) => i.kind === "navigation")).to.be.true;
	});

	it("skips special windows", function () {
		const items = buildPaletteItems({
			networks: [{name: "Libera", channels: [channel(9, "Settings", ChanType.SPECIAL)]}],
			commands: [],
		} as any);

		expect(items.filter((i) => i.kind === "channel")).to.be.empty;
	});

	it("carries channel context for actions", function () {
		const items = buildPaletteItems(source() as any);
		const general = items.find((i) => i.title === "#general")!;

		expect(general.chanId).to.equal(2);
		expect(general.subtitle).to.equal("Libera");
		expect(general.unread).to.equal(3);
	});
});

describe("palette filtering", function () {
	const items: PaletteItem[] = [
		{kind: "channel", title: "#lounge", subtitle: "Libera", chanId: 1},
		{kind: "channel", title: "#general", subtitle: "Libera", chanId: 2},
		{kind: "command", title: "/join", subtitle: "insert into input", command: "/join"},
		{
			kind: "navigation",
			title: "Open settings",
			subtitle: "general",
			route: "/settings/general",
		},
	];

	it("returns everything on an empty query", function () {
		expect(filterPaletteItems("", items)).to.have.lengthOf(4);
		expect(filterPaletteItems("   ", items)).to.have.lengthOf(4);
	});

	it("prefers substring matches", function () {
		const results = filterPaletteItems("join", items);

		expect(results[0].title).to.equal("/join");
	});

	it("matches channel names and network subtitles", function () {
		expect(filterPaletteItems("#gen", items).map((i) => i.title)).to.deep.equal(["#general"]);
		expect(
			filterPaletteItems("oftc", [
				{kind: "channel", title: "#x", subtitle: "OFTC", chanId: 9},
				...items,
			]).map((i) => i.title)
		).to.include("#x");
	});

	it("fuzzy-matches out-of-order characters", function () {
		const results = filterPaletteItems("lng", items);

		expect(results.map((i) => i.title)).to.include("#lounge");
	});

	it("returns nothing when nothing matches", function () {
		expect(filterPaletteItems("zzz-no-match", items)).to.be.empty;
	});
});
