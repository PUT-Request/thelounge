import {expect} from "vitest";
import {EventEmitter} from "events";

import chathistory, {
	isChathistoryAvailable,
	fetchBeforeHistory,
} from "../../../server/plugins/irc-events/chathistory";
import standardReply from "../../../server/plugins/irc-events/standard-reply";
import messageHandler from "../../../server/plugins/irc-events/message";
import Chan from "../../../server/models/chan";
import User from "../../../server/models/user";
import Config from "../../../server/config";
import {ChanState, ChanType} from "../../../shared/types/chan";
import {MessageType} from "../../../shared/types/msg";

function createChan(name = "#chan", messageCount = 0) {
	const chan = new Chan({
		name,
		type: ChanType.CHANNEL,
		state: ChanState.JOINED,
	});

	for (let i = 0; i < messageCount; i++) {
		chan.messages.push({id: i} as any);
	}

	return chan;
}

function setupFetch(channels: Chan[] = [], caps: string[] = []) {
	const rawCalls: any[][] = [];
	const irc = new EventEmitter() as any;
	irc.user = {nick: "me"};
	irc.network = {cap: {isEnabled: (cap: string) => caps.includes(cap)}};

	irc.raw = (...args: any[]) => {
		rawCalls.push(args);
	};

	const byName = new Map(channels.map((c) => [c.name, c]));
	const network = {
		getChannel: (name: string) => byName.get(name),
		channels,
		irc,
	} as any;

	chathistory.call({} as any, irc, network);
	return {irc, network, rawCalls};
}

describe("chathistory plugin", function () {
	describe("isChathistoryAvailable", function () {
		it("accepts the ratified capability name", function () {
			expect(
				isChathistoryAvailable({network: {cap: {isEnabled: (c) => c === "chathistory"}}})
			).to.be.true;
		});

		it("accepts the pre-ratification draft name", function () {
			expect(
				isChathistoryAvailable({
					network: {cap: {isEnabled: (c) => c === "draft/chathistory"}},
				})
			).to.be.true;
		});

		it("rejects missing caps and broken irc objects", function () {
			expect(isChathistoryAvailable({network: {cap: {isEnabled: () => false}}})).to.be.false;
			expect(isChathistoryAvailable({} as any)).to.be.false;
			expect(isChathistoryAvailable({network: {}} as any)).to.be.false;
		});
	});

	describe("fetch on join", function () {
		it("fetches LATEST history on our own join of an empty channel", function () {
			const chan = createChan();
			const {irc, rawCalls} = setupFetch([chan], ["chathistory"]);

			irc.emit("join", {nick: "me", channel: "#chan"});

			expect(rawCalls).to.have.lengthOf(1);
			expect(rawCalls[0]).to.deep.equal(["CHATHISTORY", "LATEST", "#chan", "*", "100"]);
		});

		it("fetches when only the draft capability was acknowledged", function () {
			const chan = createChan();
			const {irc, rawCalls} = setupFetch([chan], ["draft/chathistory"]);

			irc.emit("join", {nick: "me", channel: "#chan"});

			expect(rawCalls).to.have.lengthOf(1);
		});

		it("does nothing without the capability (plain IRC servers)", function () {
			const chan = createChan();
			const {irc, rawCalls} = setupFetch([chan], []);

			irc.emit("join", {nick: "me", channel: "#chan"});

			expect(rawCalls).to.have.lengthOf(0);
		});

		it("does nothing for other users joining", function () {
			const chan = createChan();
			const {irc, rawCalls} = setupFetch([chan], ["chathistory"]);

			irc.emit("join", {nick: "someone", channel: "#chan"});

			expect(rawCalls).to.have.lengthOf(0);
		});

		it("does nothing for unknown channels", function () {
			const {irc, rawCalls} = setupFetch([], ["chathistory"]);

			irc.emit("join", {nick: "me", channel: "#nope"});

			expect(rawCalls).to.have.lengthOf(0);
		});

		it("does nothing for queries", function () {
			const query = new Chan({
				name: "someone",
				type: ChanType.QUERY,
				state: ChanState.JOINED,
			});
			const {irc, rawCalls} = setupFetch([query], ["chathistory"]);

			irc.emit("join", {nick: "me", channel: "someone"});

			expect(rawCalls).to.have.lengthOf(0);
		});

		it("does not refetch channels that already hold history", function () {
			const chan = createChan("#chan", 100);
			const {irc, rawCalls} = setupFetch([chan], ["chathistory"]);

			irc.emit("join", {nick: "me", channel: "#chan"});

			expect(rawCalls).to.have.lengthOf(0);
		});
	});

	describe("fetch on cap ack", function () {
		it("backfills joined channels with little history", function () {
			const full = createChan("#full", 100);
			const empty = createChan("#empty");
			const parted = new Chan({
				name: "#parted",
				type: ChanType.CHANNEL,
				state: ChanState.PARTED,
			});
			const lobby = new Chan({name: "lobby", type: ChanType.LOBBY, state: ChanState.JOINED});
			const {irc, rawCalls} = setupFetch([full, empty, parted, lobby], ["chathistory"]);

			irc.emit("cap ack", {capabilities: {chathistory: ""}});

			expect(rawCalls).to.have.lengthOf(1);
			expect(rawCalls[0][2]).to.equal("#empty");
		});

		it("ignores acks that do not carry chathistory", function () {
			const chan = createChan();
			const {irc, rawCalls} = setupFetch([chan], ["chathistory"]);

			irc.emit("cap ack", {capabilities: {"server-time": ""}});

			expect(rawCalls).to.have.lengthOf(0);
		});
	});
});

describe("chathistory playback", function () {
	beforeEach(function () {
		Config.values.public = false;
	});

	afterEach(function () {
		Config.values.public = true;
	});

	function setupPlayback() {
		const emitted: any[] = [];
		const webPushCalls: any[] = [];
		const irc = new EventEmitter() as any;
		irc.user = {nick: "me"};
		irc.network = {cap: {isEnabled: () => false}};

		const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
		const lobby = new Chan({name: "lobby", type: ChanType.LOBBY, state: ChanState.JOINED});
		const client = {
			idMsg: 1,
			attachedClients: {},
			emit(event: string, data: any) {
				emitted.push({event, data});
			},
			save() {},
			messageStorage: [],
			mentions: [],
			highlightRegex: null,
			manager: {webPush: {push: (...args: any[]) => webPushCalls.push(args)}},
		} as any;
		const network = {
			getChannel: (name: string) => (name === "#chan" ? chan : undefined),
			getLobby: () => lobby,
			isIgnoredUser: () => false,
			highlightRegex: null,
			host: "example.com",
			irc,
		} as any;

		messageHandler.call(client, irc, network);
		return {irc, chan, lobby, client, emitted, webPushCalls};
	}

	function playbackPrivmsg(overrides: any = {}) {
		return {
			nick: "alice",
			ident: "alice",
			hostname: "example.com",
			target: "#chan",
			message: "hello from history",
			time: Date.now() - 3600000,
			tags: {},
			batch: {id: "abc", type: "chathistory", params: ["#chan"]},
			...overrides,
		};
	}

	it("stores playback without unread, highlight, mentions or notifications", function () {
		const {irc, chan, emitted, webPushCalls, client} = setupPlayback();

		irc.emit("privmsg", playbackPrivmsg());

		expect(chan.messages).to.have.lengthOf(1);
		expect(chan.messages[0].text).to.equal("hello from history");
		expect(chan.unread).to.equal(0);
		expect(chan.messages[0].highlight).to.not.be.true;
		expect(client.mentions).to.have.lengthOf(0);
		expect(webPushCalls).to.have.lengthOf(0);
		// The message itself is still delivered to connected clients
		expect(emitted.filter((e) => e.event === "msg")).to.have.lengthOf(1);
	});

	it("uses the server-time of playback messages", function () {
		const {irc, chan} = setupPlayback();
		const time = Date.now() - 7200000;

		irc.emit("privmsg", playbackPrivmsg({time}));

		expect(chan.messages[0].time.getTime()).to.equal(time);
	});

	it("drops playback duplicates instead of storing them twice", function () {
		const {irc, chan, emitted} = setupPlayback();
		const time = Date.now() - 3600000;

		irc.emit("privmsg", playbackPrivmsg({time}));
		irc.emit("privmsg", playbackPrivmsg({time}));

		expect(chan.messages).to.have.lengthOf(1);
		expect(emitted.filter((e) => e.event === "msg")).to.have.lengthOf(1);
	});

	it("routes playback notices to the batch target, never the lobby", function () {
		const {irc, chan, lobby} = setupPlayback();

		irc.emit("notice", playbackPrivmsg({message: "old notice"}));

		expect(chan.messages).to.have.lengthOf(1);
		expect(chan.messages[0].showInActive).to.not.be.true;
		expect(lobby.messages).to.have.lengthOf(0);
	});

	it("drops playback for channels that no longer exist", function () {
		const {irc, chan} = setupPlayback();

		irc.emit(
			"privmsg",
			playbackPrivmsg({batch: {id: "abc", type: "chathistory", params: ["#gone"]}})
		);

		expect(chan.messages).to.have.lengthOf(0);
	});

	it("treats malformed batches as live traffic instead of crashing", function () {
		const {irc, chan} = setupPlayback();

		// batch claims chathistory but carries no usable target
		irc.emit("privmsg", playbackPrivmsg({batch: {id: "abc", type: "chathistory"}}));

		expect(chan.messages).to.have.lengthOf(1);
	});

	it("records the sender account from account-tag", function () {
		const {irc, chan} = setupPlayback();
		chan.setUser(new User({nick: "alice"}));

		irc.emit("privmsg", playbackPrivmsg({account: "alice-account"}));

		expect(chan.messages[0].from.account).to.equal("alice-account");
		expect(chan.findUser("alice")?.account).to.equal("alice-account");
	});

	it("ignores empty account tags", function () {
		const {irc, chan} = setupPlayback();

		irc.emit("privmsg", playbackPrivmsg({account: "*"}));

		expect(chan.messages[0].from.account).to.be.undefined;
	});

	it("still bumps unread for live traffic", function () {
		const {irc, chan} = setupPlayback();

		irc.emit(
			"privmsg",
			playbackPrivmsg({message: "live message", time: Date.now(), batch: undefined})
		);

		expect(chan.messages).to.have.lengthOf(1);
		expect(chan.unread).to.equal(1);
	});

	it("defaults unparsable server-time to now", function () {
		const {irc, chan} = setupPlayback();
		const before = Date.now();

		irc.emit("privmsg", playbackPrivmsg({time: undefined, batch: undefined}));

		expect(chan.messages[0].time.getTime()).to.be.at.least(before);
	});

	it("routes CHATHISTORY failures to the channel", function () {
		const irc = new EventEmitter() as any;
		const lobby = {
			name: "lobby",
			pushed: [] as any[],
			pushMessage(_c: any, m: any) {
				this.pushed.push(m);
			},
		};
		const channel = {
			name: "#chan",
			pushed: [] as any[],
			pushMessage(_c: any, m: any) {
				this.pushed.push(m);
			},
		};
		const network = {
			getLobby: () => lobby,
			getChannel: (name: string) => (name === "#chan" ? channel : undefined),
		} as any;

		standardReply.call({} as any, irc, network);

		irc.emit("standard reply", {
			type: "FAIL",
			command: "CHATHISTORY",
			code: "INVALID_TARGET",
			context: ["#chan"],
			description: "Messages could not be retrieved",
		});

		expect(channel.pushed).to.have.lengthOf(1);
		expect(channel.pushed[0].type).to.equal(MessageType.ERROR);
		expect(channel.pushed[0].text).to.contain("Messages could not be retrieved");
		expect(lobby.pushed).to.have.lengthOf(0);
	});
});

describe("chathistory load-older", function () {
	let setupCounter = 0;

	beforeEach(function () {
		Config.values.public = false;
	});

	afterEach(function () {
		Config.values.public = true;
	});

	function setupBoth() {
		const rawCalls: any[][] = [];
		const emitted: any[] = [];
		const webPushCalls: any[] = [];
		const flushed: string[] = [];
		const irc = new EventEmitter() as any;
		irc.user = {nick: "me"};
		irc.network = {cap: {isEnabled: (cap: string) => cap === "chathistory"}};
		irc.raw = (...args: any[]) => rawCalls.push(args);

		const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
		let nextStorageId = 1000;
		const provider = {
			index(_n: any, _c: any, msg: any) {
				msg.storageId = nextStorageId++;
			},
			flushBatch() {
				flushed.push("flush");
			},
		};
		const client = {
			idMsg: 1,
			attachedClients: {},
			emit: (event: string, data: any) => emitted.push({event, data}),
			save() {},
			messageStorage: [provider],
			mentions: [],
			highlightRegex: null,
			manager: {webPush: {push: (...args: any[]) => webPushCalls.push(args)}},
		} as any;
		const network = {
			uuid: `net-older-${setupCounter++}`,
			getChannel: (name: string) => (name.toLowerCase() === "#chan" ? chan : undefined),
			getLobby: () => chan,
			isIgnoredUser: () => false,
			highlightRegex: null,
			host: "example.com",
			irc,
			channels: [chan],
		} as any;

		messageHandler.call(client, irc, network);
		chathistory.call(client, irc, network);
		return {irc, chan, client, network, emitted, rawCalls, flushed, webPushCalls};
	}

	function beforePlayback(time: number, text: string, extra: any = {}) {
		return {
			nick: "alice",
			ident: "a",
			hostname: "h",
			target: "#chan",
			message: text,
			time,
			tags: {},
			batch: {id: "b1", type: "chathistory", params: ["#chan"]},
			...extra,
		};
	}

	it("sends BEFORE anchored at the oldest held message", function () {
		const {chan, client, network, rawCalls} = setupBoth();
		chan.messages.push({id: 1, time: new Date(1700000000000)} as any);

		const sent = fetchBeforeHistory(client, network, chan);

		expect(sent).to.be.true;
		expect(rawCalls).to.have.lengthOf(1);
		expect(rawCalls[0][0]).to.equal("CHATHISTORY");
		expect(rawCalls[0][1]).to.equal("BEFORE");
		expect(rawCalls[0][2]).to.equal("#chan");
		expect(rawCalls[0][3]).to.equal(new Date(1700000000000).toISOString());
		expect(rawCalls[0][4]).to.equal("100");
	});

	it("refuses duplicate, unsupported or unsuitable fetches", function () {
		const {chan, client, network, rawCalls} = setupBoth();

		expect(fetchBeforeHistory(client, network, chan)).to.be.true;
		// A second fetch while one is pending is refused
		expect(fetchBeforeHistory(client, network, chan)).to.be.false;

		const parted = new Chan({name: "#p", type: ChanType.CHANNEL, state: ChanState.PARTED});
		expect(fetchBeforeHistory(client, network, parted)).to.be.false;

		const special = new Chan({name: "x", type: ChanType.SPECIAL, state: ChanState.JOINED});
		expect(fetchBeforeHistory(client, network, special)).to.be.false;

		const noCap = {...network, irc: {network: {cap: {isEnabled: () => false}}}};
		expect(fetchBeforeHistory(client, noCap as any, chan)).to.be.false;

		// Only the single accepted fetch sent anything
		expect(rawCalls).to.have.lengthOf(1);
	});

	it("delivers a BEFORE batch as one sorted prepend", function () {
		const {irc, chan, client, network, emitted, flushed, webPushCalls} = setupBoth();
		chan.messages.push({id: 1, time: new Date(1700000100000), text: "live"} as any);

		expect(fetchBeforeHistory(client, network, chan)).to.be.true;
		irc.emit("privmsg", beforePlayback(1700000050000, "newer old"));
		irc.emit("privmsg", beforePlayback(1700000000000, "older old"));

		// Diverted: nothing delivered or stored yet
		expect(emitted.filter((e) => e.event === "msg")).to.have.lengthOf(0);
		expect(chan.messages).to.have.lengthOf(1);

		irc.emit("batch end chathistory", {params: ["#chan"]});

		const more = emitted.filter((e) => e.event === "more");
		expect(more).to.have.lengthOf(1);
		expect(more[0].data.messages.map((m: any) => m.text)).to.deep.equal([
			"older old",
			"newer old",
		]);
		expect(chan.messages.map((m: any) => m.text)).to.deep.equal([
			"older old",
			"newer old",
			"live",
		]);
		expect(chan.unread).to.equal(0);
		expect(webPushCalls).to.have.lengthOf(0);
		expect(flushed.length).to.be.greaterThan(0);
		// Storage ids stamped before delivery so future pages dedupe
		expect(more[0].data.messages[0].storageId).to.be.a("number");
	});

	it("dedupes overlapping rows on delivery", function () {
		const {irc, chan, client, network, emitted} = setupBoth();
		const time = 1700000000000;
		chan.messages.push({
			id: 1,
			time: new Date(time),
			text: "dup",
			type: MessageType.MESSAGE,
			from: {nick: "alice"},
		} as any);

		expect(fetchBeforeHistory(client, network, chan)).to.be.true;
		irc.emit("privmsg", beforePlayback(time, "dup"));
		irc.emit("batch end chathistory", {params: ["#chan"]});

		const more = emitted.filter((e) => e.event === "more");
		expect(more).to.have.lengthOf(1);
		expect(more[0].data.messages).to.have.lengthOf(0);
		expect(chan.messages).to.have.lengthOf(1);
	});

	it("drops batches for vanished channels and unknown batches", function () {
		const {irc, emitted} = setupBoth();

		irc.emit("batch end chathistory", {params: ["#gone"]});
		irc.emit("batch end chathistory", {params: []});

		expect(emitted.filter((e) => e.event === "more")).to.have.lengthOf(0);
	});

	it("drops the fetch on FAIL so retries start clean", function () {
		const {irc, chan, client, network, emitted, rawCalls} = setupBoth();

		expect(fetchBeforeHistory(client, network, chan)).to.be.true;
		irc.emit("standard reply", {
			type: "FAIL",
			command: "CHATHISTORY",
			code: "INVALID_TARGET",
			context: ["#chan"],
			description: "nope",
		});
		irc.emit("batch end chathistory", {params: ["#chan"]});

		expect(emitted.filter((e) => e.event === "more")).to.have.lengthOf(0);
		// Retry allowed after the drop
		expect(fetchBeforeHistory(client, network, chan)).to.be.true;
		expect(rawCalls).to.have.lengthOf(2);
	});
});
