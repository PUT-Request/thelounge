import {expect} from "vitest";
import {EventEmitter} from "events";

import joinHandler from "../../../server/plugins/irc-events/join";
import namesHandler from "../../../server/plugins/irc-events/names";
import monitorHandler from "../../../server/plugins/irc-events/monitor";
import Chan from "../../../server/models/chan";
import User from "../../../server/models/user";
import Prefix from "../../../server/models/prefix";
import Config from "../../../server/config";
import {ChanState, ChanType} from "../../../shared/types/chan";
import {MessageType} from "../../../shared/types/msg";

describe("IRCv3 user metadata", function () {
	beforeEach(function () {
		Config.values.public = false;
	});

	afterEach(function () {
		Config.values.public = true;
	});

	describe("extended-join on JOIN", function () {
		function setupJoin(existing?: Chan) {
			const emitted: any[] = [];
			const rawCalls: any[][] = [];
			const irc = new EventEmitter() as any;
			irc.user = {nick: "me"};
			irc.network = {cap: {isEnabled: () => false}};
			irc.who = (_target: string, cb: any) => cb({users: []});
			irc.raw = (...args: any[]) => rawCalls.push(args);

			const chan =
				existing ??
				new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			const network = {
				getChannel: (name: string) => (name === "#chan" ? chan : undefined),
				addChannel: () => 1,
				irc,
			} as any;
			const created: Chan[] = [];
			const client = {
				idMsg: 1,
				idChan: 100,
				attachedClients: {},
				emit: (event: string, data: any) => emitted.push({event, data}),
				save() {},
				messageStorage: [],
				createChannel(attr: any) {
					const c = new Chan(attr);
					c.id = 100;
					created.push(c);
					return c;
				},
				massEventAggregator: {processMessage: () => false},
			} as any;

			joinHandler.call(client, irc, network);
			return {irc, chan, network, client, emitted};
		}

		it("stores account, ident and hostname from extended-join", function () {
			const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			const {irc} = setupJoin(chan);

			irc.emit("join", {
				channel: "#chan",
				nick: "bob",
				ident: "~bob",
				hostname: "host.example",
				account: "bob-acc",
				gecos: "Bob Example",
				time: Date.now(),
			});

			const user = chan.findUser("bob");
			expect(user?.ident).to.equal("~bob");
			expect(user?.hostname).to.equal("host.example");
			expect(user?.account).to.equal("bob-acc");

			const msg = chan.messages[chan.messages.length - 1];
			expect(msg.type).to.equal(MessageType.JOIN);
			expect(msg.from.account).to.equal("bob-acc");
			expect(msg.gecos).to.equal("Bob Example");
		});

		it("leaves account undefined without extended-join data", function () {
			const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			const {irc} = setupJoin(chan);

			irc.emit("join", {
				channel: "#chan",
				nick: "carol",
				ident: "~carol",
				hostname: "host.example",
				time: Date.now(),
			});

			expect(chan.findUser("carol")?.account).to.be.undefined;
			expect(chan.findUser("carol")?.ident).to.equal("~carol");
		});
	});

	describe("userhost-in-names on NAMES", function () {
		function setupNames(chan: Chan) {
			const emitted: any[] = [];
			const irc = new EventEmitter() as any;
			const network = {
				getChannel: (name: string) => (name === "#chan" ? chan : undefined),
				serverOptions: {PREFIX: new Prefix([{symbol: "@", mode: "o"}])},
			} as any;
			const client = {
				emit: (event: string, data: any) => emitted.push({event, data}),
			} as any;

			namesHandler.call(client, irc, network);
			return {irc, emitted};
		}

		it("stores ident and hostname from full masks", function () {
			const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			const {irc} = setupNames(chan);

			irc.emit("userlist", {
				channel: "#chan",
				users: [{nick: "bob", ident: "~bob", hostname: "host.example", modes: []}],
			});

			expect(chan.findUser("bob")?.ident).to.equal("~bob");
			expect(chan.findUser("bob")?.hostname).to.equal("host.example");
		});

		it("tolerates masks without userhost (servers without the cap)", function () {
			const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			const {irc, emitted} = setupNames(chan);

			irc.emit("userlist", {
				channel: "#chan",
				users: [{nick: "carol", modes: []}],
			});

			expect(chan.findUser("carol")?.ident).to.be.undefined;
			expect(chan.findUser("carol")?.hostname).to.be.undefined;
			expect(emitted.filter((e) => e.event === "users")).to.have.lengthOf(1);
		});
	});

	describe("account-notify on ACCOUNT", function () {
		function setupAccount(channels: Chan[], monitor: number | null) {
			const emitted: any[] = [];
			const irc = new EventEmitter() as any;
			const byName = new Map(channels.map((c) => [c.name.toLowerCase(), c]));
			const network = {
				channels,
				getChannel: (name: string) => byName.get(name.toLowerCase()),
				serverOptions: {MONITOR: monitor},
			} as any;
			const client = {
				idMsg: 1,
				attachedClients: {},
				emit: (event: string, data: any) => emitted.push({event, data}),
				save() {},
				messageStorage: [],
				highlightRegex: null,
			} as any;

			monitorHandler.call(client, irc, network);
			return {irc, emitted};
		}

		it("updates tracked users in shared channels without MONITOR", function () {
			const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			chan.setUser(new User({nick: "bob"}));
			const {irc, emitted} = setupAccount([chan], null);

			irc.emit("account", {nick: "bob", account: "bob-acc", time: Date.now()});

			expect(chan.findUser("bob")?.account).to.equal("bob-acc");
			expect(emitted.filter((e) => e.event === "users")).to.have.lengthOf(1);
		});

		it("clears the account on logout", function () {
			const chan = new Chan({name: "#chan", type: ChanType.CHANNEL, state: ChanState.JOINED});
			chan.setUser(new User({nick: "bob", account: "bob-acc"}));
			const {irc} = setupAccount([chan], null);

			irc.emit("account", {nick: "bob", account: false, time: Date.now()});

			expect(chan.findUser("bob")?.account).to.be.undefined;
		});

		it("announces login and logout in monitored queries", function () {
			const query = new Chan({name: "dave", type: ChanType.QUERY, state: ChanState.JOINED});
			const {irc} = setupAccount([query], 100);

			irc.emit("account", {nick: "dave", account: "dave-acc", time: Date.now()});
			irc.emit("account", {nick: "dave", account: false, time: Date.now()});

			expect(query.messages).to.have.lengthOf(2);
			expect(query.messages[0].type).to.equal(MessageType.LOGIN);
			expect(query.messages[0].text).to.equal("dave-acc");
			expect(query.messages[1].type).to.equal(MessageType.LOGOUT);
		});
	});
});
