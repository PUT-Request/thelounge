import {expect} from "vitest";
import {EventEmitter} from "events";

import inviteHandler, {
	upsertPendingInvite,
	removePendingInvite,
	syncInvitesWindow,
	openInvitesWindow,
} from "../../../server/plugins/irc-events/invite";
import joinHandler from "../../../server/plugins/irc-events/join";
import inviteInput from "../../../server/plugins/inputs/invite";
import Chan from "../../../server/models/chan";
import Config from "../../../server/config";
import {ChanState, ChanType, SpecialChanType} from "../../../shared/types/chan";
import {MessageType} from "../../../shared/types/msg";
import {ircCasefold} from "../../../shared/irc";

describe("invite center", function () {
	beforeEach(function () {
		Config.values.public = false;
	});

	afterEach(function () {
		Config.values.public = true;
	});

	function setupInvite(channels: Chan[] = []) {
		const emitted: any[] = [];
		const webPushCalls: any[] = [];
		const irc = new EventEmitter() as any;
		irc.user = {nick: "me"};
		irc.network = {cap: {isEnabled: () => false}};

		const lobby =
			channels.find((c) => c.type === ChanType.LOBBY) ??
			new Chan({name: "lobby", type: ChanType.LOBBY, state: ChanState.JOINED});
		const all = channels.includes(lobby) ? channels : [lobby, ...channels];
		const client = {
			idMsg: 1,
			idChan: 100,
			attachedClients: {},
			emit: (event: string, data: any) => emitted.push({event, data}),
			save() {},
			messageStorage: [],
			flushMessageStorage() {},
			mentions: [],
			highlightRegex: null,
			manager: {webPush: {push: (...args: any[]) => webPushCalls.push(args)}},
			createChannel(attr: any) {
				const c = new Chan(attr);
				c.id = 100 + all.length;
				return c;
			},
		} as any;
		const byName = new Map(all.map((c) => [c.name.toLowerCase(), c]));
		const network = {
			uuid: "net-invites",
			casefold: (value: string) => ircCasefold(value, "rfc1459"),
			getChannel: (name: string) => byName.get(name.toLowerCase()),
			getLobby: () => lobby,
			addChannel(chan: Chan) {
				all.push(chan);
				byName.set(chan.name.toLowerCase(), chan);
				return all.length - 1;
			},
			channels: all,
			pendingInvites: [] as any[],
			irc,
		} as any;

		inviteHandler.call(client, irc, network);
		return {irc, lobby, client, network, emitted, webPushCalls};
	}

	function inviteEvent(channel = "#secret", nick = "alice", invited = "me") {
		return {channel, nick, invited, ident: "a", hostname: "h", time: Date.now()};
	}

	it("tracks direct invites and notifies", function () {
		const {irc, lobby, network, emitted, webPushCalls} = setupInvite();

		irc.emit("invite", inviteEvent());

		expect(network.pendingInvites).to.have.lengthOf(1);
		expect(network.pendingInvites[0]).to.include({channel: "#secret", from: "alice"});
		expect(lobby.messages).to.have.lengthOf(1);
		expect(lobby.messages[0].type).to.equal(MessageType.INVITE);
		expect(lobby.messages[0].highlight).to.be.true;
		expect(lobby.messages[0].invitedYou).to.be.true;
		expect(webPushCalls).to.have.lengthOf(1);
		expect(webPushCalls[0][1].title).to.equal("#secret");
		expect(webPushCalls[0][1].body).to.contain("alice");
		// No window open: nothing to sync
		expect(emitted.filter((e) => e.event === "msg:special")).to.have.lengthOf(0);
	});

	it("updates the entry instead of duplicating it", function () {
		const {irc, network} = setupInvite();

		irc.emit("invite", inviteEvent("#secret", "alice"));
		irc.emit("invite", inviteEvent("#secret", "bob"));

		expect(network.pendingInvites).to.have.lengthOf(1);
		expect(network.pendingInvites[0].from).to.equal("bob");
	});

	it("ignores invites for other users", function () {
		const {irc, lobby, network, webPushCalls} = setupInvite();

		irc.emit("invite", inviteEvent("#secret", "alice", "carol"));

		expect(network.pendingInvites).to.have.lengthOf(0);
		expect(lobby.messages[0].highlight).to.not.be.true;
		expect(webPushCalls).to.have.lengthOf(0);
	});

	it("refreshes an open window on new invites", function () {
		const {irc, network, client, emitted} = setupInvite();
		openInvitesWindow(client, network);
		emitted.length = 0;

		irc.emit("invite", inviteEvent());

		const syncs = emitted.filter((e) => e.event === "msg:special");
		expect(syncs).to.have.lengthOf(1);
		expect(syncs[0].data.data).to.have.lengthOf(1);
	});

	it("opens the window on /invites without duplicating it", function () {
		const {network, client, emitted} = setupInvite();
		const lobby = network.getLobby();
		client.find = () => ({network, chan: lobby});

		inviteInput.input.call(client, {irc: network.irc} as any, lobby, "invites", []);
		inviteInput.input.call(client, {irc: network.irc} as any, lobby, "invites", []);

		const joins = emitted.filter((e) => e.event === "join");
		expect(joins).to.have.lengthOf(1);
		expect(joins[0].data.chan.special).to.equal(SpecialChanType.INVITES);
		expect(joins[0].data.shouldOpen).to.be.true;
	});

	it("clears the entry when joining the channel", function () {
		const chan = new Chan({name: "#secret", type: ChanType.CHANNEL, state: ChanState.PARTED});
		const {irc, network, client, emitted} = setupInvite([chan]);
		irc.user = {nick: "me"};
		irc.who = (_t: string, cb: any) => cb({users: []});

		irc.raw = () => {};

		network.irc = irc;
		client.massEventAggregator = {processMessage: () => false};

		upsertPendingInvite(network, {channel: "#secret", from: "alice", time: Date.now()});
		openInvitesWindow(client, network);
		emitted.length = 0;

		joinHandler.call(client, irc, network);
		irc.emit("join", {
			channel: "#secret",
			nick: "me",
			ident: "m",
			hostname: "h",
			time: Date.now(),
		});

		expect(network.pendingInvites).to.have.lengthOf(0);
		const syncs = emitted.filter((e) => e.event === "msg:special");
		expect(syncs).to.have.lengthOf(1);
		expect(syncs[0].data.data).to.have.lengthOf(0);
	});

	it("removes entries directly", function () {
		const {network} = setupInvite();
		upsertPendingInvite(network, {channel: "#a", from: "alice", time: 1});
		upsertPendingInvite(network, {channel: "#B", from: "bob", time: 2});

		expect(removePendingInvite(network, "#A")).to.be.true;
		expect(removePendingInvite(network, "#missing")).to.be.false;
		expect(network.pendingInvites.map((i: any) => i.channel)).to.deep.equal(["#B"]);
	});

	it("syncs nothing without an open window", function () {
		const {network, client, emitted} = setupInvite();
		upsertPendingInvite(network, {channel: "#a", from: "alice", time: 1});

		syncInvitesWindow(client, network);

		expect(emitted.filter((e) => e.event === "msg:special")).to.have.lengthOf(0);
	});
});
