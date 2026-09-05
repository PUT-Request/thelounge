import {expect} from "vitest";
import {EventEmitter} from "events";

import Network from "../../server/models/network";
import Chan from "../../server/models/chan";
import Config from "../../server/config";
import {ChanType} from "../../shared/types/chan";
import joinPlugin from "../../server/plugins/irc-events/join";
import messagePlugin from "../../server/plugins/irc-events/message";
import namesPlugin from "../../server/plugins/irc-events/names";
import nickPlugin from "../../server/plugins/irc-events/nick";
import partPlugin from "../../server/plugins/irc-events/part";
import quitPlugin from "../../server/plugins/irc-events/quit";
import chathistoryPlugin from "../../server/plugins/irc-events/chathistory";
import monitorPlugin from "../../server/plugins/irc-events/monitor";
import welcomePlugin from "../../server/plugins/irc-events/welcome";
import motdPlugin from "../../server/plugins/irc-events/motd";
import {FakeIrcServer} from "./fakeServer";

const BASE_CAPS = [
	"multi-prefix",
	"extended-join",
	"account-tag",
	"account-notify",
	"away-notify",
	"server-time",
	"message-tags",
	"batch",
	"echo-message",
	"labeled-response",
	"standard-replies",
	"userhost-in-names",
	"invite-notify",
	"chathistory",
];

type Stack = {
	server: FakeIrcServer;
	network: any;
	client: any;
	emitted: Array<{event: string; data: any}>;
};

async function setupStack(offeredCaps: string[]): Promise<Stack> {
	const server = new FakeIrcServer();
	await server.start();

	const network: any = new Network({
		name: "FakeTest",
		host: "127.0.0.1",
		port: server.port,
		nick: "e2e",
		username: "e2e",
		realname: "e2e",
	});
	network.highlightRegex = null;

	let idChan = 100;
	const emitted: Array<{event: string; data: any}> = [];
	const client: any = new EventEmitter();
	Object.assign(client, {
		idMsg: 1,
		attachedClients: {},
		config: {},
		emit(event: string, data: any) {
			emitted.push({event, data});
		},
		save() {},
		messageStorage: [],
		mentions: [],
		highlightRegex: null,
		manager: {webPush: {push() {}}},
		massEventAggregator: {processMessage: () => false},
		createChannel(attr: any) {
			const chan = new Chan(attr);
			chan.id = idChan++;
			return chan;
		},
	});

	network.createIrcFramework(client);
	network.irc.options.auto_reconnect = false;

	for (const plugin of [
		joinPlugin,
		messagePlugin,
		namesPlugin,
		nickPlugin,
		partPlugin,
		quitPlugin,
		chathistoryPlugin,
		monitorPlugin,
		welcomePlugin,
		motdPlugin,
	]) {
		plugin.call(client, network.irc, network);
	}

	let welcomed = false;

	server.onLine = (line, send) => {
		if (line.startsWith("CAP LS")) {
			send(`:fake.test CAP * LS :${offeredCaps.join(" ")}`);
		} else if (line.startsWith("CAP REQ")) {
			const wanted = (line.split(" :")[1] || "").split(" ").filter(Boolean);
			const acked = wanted.filter((cap) => offeredCaps.includes(cap.split("=")[0]));
			send(`:fake.test CAP * ACK :${acked.join(" ")}`);
		} else if (line.startsWith("PING")) {
			send(`:fake.test PONG fake.test :${line.split(" ").slice(1).join(" ")}`);
		}

		if (/^NICK /.test(line)) {
			(client as any).nickSeen = true;
		}

		if (/^USER /.test(line)) {
			(client as any).userSeen = true;
		}

		// Per the CAP spec the server completes negotiation (CAP END from
		// the client) before sending the welcome burst.
		if (
			line === "CAP END" &&
			(client as any).nickSeen &&
			(client as any).userSeen &&
			!welcomed
		) {
			welcomed = true;
			send(":fake.test 001 e2e :Welcome to FakeTest");
			send(
				":fake.test 005 e2e CHANTYPES=# PREFIX=(ov)@+ NETWORK=FakeTest MONITOR=100 :are supported"
			);
			send(":fake.test 376 e2e :End of MOTD");
		}
	};

	network.irc.connect();
	await server.waitForLine((line) => line === "CAP END", 10000);

	let registered = false;
	network.irc.once("registered", () => {
		registered = true;
	});
	await server.waitFor(() => registered, 10000);

	return {server, network, client, emitted};
}

async function teardownStack(stack: Stack): Promise<void> {
	try {
		stack.network.irc.quit("test done");
	} catch {
		// already gone
	}

	await stack.server.close();
}

describe("IRC protocol end-to-end", function () {
	beforeEach(function () {
		Config.values.public = false;
	});

	afterEach(function () {
		Config.values.public = true;
	});

	it("negotiates capabilities and exposes them", async function () {
		const stack = await setupStack(BASE_CAPS);

		try {
			const cap = stack.network.irc.network.cap;

			for (const name of [
				"chathistory",
				"invite-notify",
				"userhost-in-names",
				"echo-message",
				"server-time",
			]) {
				expect(cap.isEnabled(name), name).to.be.true;
			}

			const req = await stack.server.waitForLine((line) => line.startsWith("CAP REQ"));
			expect(req).to.contain("chathistory");
			expect(req).to.contain("userhost-in-names");
		} finally {
			await teardownStack(stack);
		}
	});

	it("falls back cleanly when the server offers nothing", async function () {
		const stack = await setupStack([]);

		try {
			stack.network.irc.join("#plain");
			await stack.server.waitForLine((line) => line === "JOIN #plain");

			stack.server.send(":e2e!e2e@h JOIN #plain");
			stack.server.send(":e2e!e2e@h PRIVMSG #plain :hello without caps");

			await stack.server.waitFor(() => {
				const chan = stack.network.getChannel("#plain");
				return chan && chan.messages.length >= 2;
			});

			const chan = stack.network.getChannel("#plain");
			expect(chan.messages.map((m: any) => m.text)).to.include("hello without caps");
			// No history fetch attempted against a server without the cap
			expect(stack.server.received.some((line) => line.startsWith("CHATHISTORY"))).to.be
				.false;
		} finally {
			await teardownStack(stack);
		}
	});

	it("stores tagged messages with metadata", async function () {
		const stack = await setupStack(BASE_CAPS);

		try {
			stack.network.irc.join("#test");
			await stack.server.waitForLine((line) => line === "JOIN #test");

			stack.server.send(":e2e!e2e@h JOIN #test");
			stack.server.send(":fake.test 353 e2e = #test :e2e!e2e@h @alice!a@host");
			stack.server.send(":fake.test 366 e2e #test :End of NAMES");
			stack.server.send(
				"@msgid=abc123;time=2026-01-01T00:00:00.000Z;account=alice :alice!a@host PRIVMSG #test :hello with tags"
			);

			await stack.server.waitFor(() => {
				const chan = stack.network.getChannel("#test");
				return chan && chan.messages.some((m: any) => m.text === "hello with tags");
			});

			const chan = stack.network.getChannel("#test");
			const msg = chan.messages.find((m: any) => m.text === "hello with tags");
			expect(msg.msgid).to.equal("abc123");
			expect(msg.time.getTime()).to.equal(new Date("2026-01-01T00:00:00.000Z").getTime());
			expect(msg.from.account).to.equal("alice");
			expect(chan.findUser("alice")?.hostname).to.equal("host");
		} finally {
			await teardownStack(stack);
		}
	});

	it("plays back chathistory on join without unread", async function () {
		const stack = await setupStack(BASE_CAPS);

		try {
			stack.network.irc.join("#test");
			await stack.server.waitForLine((line) => line === "JOIN #test");

			stack.server.send(":e2e!e2e@h JOIN #test");
			stack.server.send(":fake.test 353 e2e = #test :e2e!e2e@h");
			stack.server.send(":fake.test 366 e2e #test :End of NAMES");

			const fetch = await stack.server.waitForLine((line) =>
				line.startsWith("CHATHISTORY LATEST #test")
			);
			expect(fetch).to.contain("* 100");

			stack.server.send("BATCH +h1 chathistory #test");
			stack.server.send(
				"@batch=h1;msgid=m1;time=2026-01-01T00:00:00.000Z;account=alice :alice!a@host PRIVMSG #test :history one"
			);
			stack.server.send(
				"@batch=h1;msgid=m2;time=2026-01-01T00:01:00.000Z :bob!b@host PRIVMSG #test :history two"
			);
			stack.server.send("BATCH -h1");

			await stack.server.waitFor(() => {
				const chan = stack.network.getChannel("#test");
				return chan && chan.messages.filter((m: any) => m.msgid === "m2").length === 1;
			});

			const chan = stack.network.getChannel("#test");
			expect(chan.unread).to.equal(0);
			expect(chan.messages.filter((m: any) => m.msgid === "m1")[0].from.account).to.equal(
				"alice"
			);
		} finally {
			await teardownStack(stack);
		}
	});

	it("tracks account-notify", async function () {
		const stack = await setupStack(BASE_CAPS);

		try {
			stack.network.irc.join("#test");
			await stack.server.waitForLine((line) => line === "JOIN #test");

			stack.server.send(":e2e!e2e@h JOIN #test");
			stack.server.send(":fake.test 353 e2e = #test :e2e!e2e@h alice!a@host");
			stack.server.send(":fake.test 366 e2e #test :End of NAMES");
			stack.server.send(":alice!a@host ACCOUNT alice-acc");

			await stack.server.waitFor(
				() => stack.network.getChannel("#test")?.findUser("alice")?.account === "alice-acc"
			);

			expect(stack.network.getChannel("#test").findUser("alice")?.account).to.equal(
				"alice-acc"
			);
		} finally {
			await teardownStack(stack);
		}
	});

	it("survives malformed input", async function () {
		const stack = await setupStack(BASE_CAPS);

		try {
			stack.server.send("GARBAGE [[[ :::");
			// Batch end without an opener: dropped, connection stays up
			stack.server.send("BATCH -never-opened");
			// Unparsable server-time falls back to local time
			stack.server.send("@time=not-a-date :nick!u@h PRIVMSG #test :bad time");
			// Unknown numerics are routed, never fatal
			stack.server.send(":fake.test 999 e2e #test :mystery numeric");

			// The connection still answers pings afterwards
			stack.server.send(":fake.test PING :12345");
			const pong = await stack.server.waitForLine((line) => line.startsWith("PONG"));

			expect(pong).to.contain("12345");
			expect(stack.network.irc.connected).to.be.true;
		} finally {
			await teardownStack(stack);
		}
	});
});
