import {expect} from "vitest";
import {NetworkConfig} from "../server/models/network";
import {ChanConfig} from "../server/models/chan";
import Msg from "../server/models/msg";
import {ChanType} from "../shared/types/chan";
import ClientManager from "../server/clientManager";
import Client from "../server/client";
import log from "../server/log";

import sinon from "ts-sinon";

describe("Client", function () {
	const commonNetworkConfig: NetworkConfig = {
		uuid: "67363f03-d903-498b-8e52-031ebb912791",
		awayMessage: "",
		name: "Super Nice Network",
		nick: "thelounge0001",
		host: "example.org",
		port: 6667,
		tls: false,
		userDisconnected: false,
		rejectUnauthorized: true,
		password: "",
		username: "thelounge",
		realname: "thelounge26",
		leaveMessage: "",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
		commands: [],
		ignoreList: [],
		proxyHost: "",
		proxyPort: 1080,
		proxyUsername: "",
		proxyEnabled: false,
		proxyPassword: "",
		channels: [],
	};
	let logWarnStub: sinon.SinonStub<string[], void>;

	beforeAll(function () {
		logWarnStub = sinon.stub(log, "warn");
	});

	afterAll(function () {
		logWarnStub.restore();
	});

	it("should parse channel configuration", function () {
		const manager = new ClientManager();
		const channel: ChanConfig = {name: "AAAA!", type: "query"};
		const networkConfig: NetworkConfig = {
			...commonNetworkConfig,
			channels: [{name: "AAAA!", type: "query"}, {name: "#thelounge"}, {name: "&foobar"}],
		};
		const client = new Client(manager, "test", {
			log: false,
			password: "foo",
			sessions: {},
			clientSettings: {},
			networks: [networkConfig],
		});

		// The client would normally do it as part of client.connect();
		// but this avoids the need to mock the irc-framework connection
		const network = client.networkFromConfig(networkConfig);

		sinon.assert.notCalled(logWarnStub);

		expect(network.channels[0].name).to.equal("Super Nice Network");
		expect(network.channels[0].type).to.equal(ChanType.LOBBY);
		expect(network.channels[1].name).to.equal("AAAA!");
		expect(network.channels[1].type).to.equal(ChanType.QUERY);
		expect(network.channels[2].name).to.equal("#thelounge");
		expect(network.channels[2].type).to.equal(ChanType.CHANNEL);
		expect(network.channels[3].name).to.equal("&foobar");
		expect(network.channels[3].type).to.equal(ChanType.CHANNEL);
	});

	it("should ignore invalid channel types", function () {
		const manager = new ClientManager();
		const channel: ChanConfig = {name: "AAAA!", type: "query"};
		const networkConfig: NetworkConfig = {
			...commonNetworkConfig,
			channels: [
				{name: "AAAA!", type: "query"},
				{name: "#thelounge", type: "wrongtype"},
				{name: "&foobar"},
			],
		};
		const client = new Client(manager, "test", {
			log: false,
			password: "foo",
			sessions: {},
			clientSettings: {},
			networks: [networkConfig],
		});

		// The client would normally do it as part of client.connect();
		// but this avoids the need to mock the irc-framework connection
		const network = client.networkFromConfig(networkConfig);

		sinon.assert.calledOnce(logWarnStub);

		expect(network.channels[0].name).to.equal("Super Nice Network");
		expect(network.channels[0].type).to.equal(ChanType.LOBBY);
		expect(network.channels[1].name).to.equal("AAAA!");
		expect(network.channels[1].type).to.equal(ChanType.QUERY);
		expect(network.channels[2].name).to.equal("&foobar");
		expect(network.channels[2].type).to.equal(ChanType.CHANNEL);
	});

	it("should page more() from the database once memory is exhausted", function () {
		const manager = new ClientManager();
		const client = new Client(manager, "test", {
			log: false,
			password: "foo",
			sessions: {},
			clientSettings: {},
			networks: [],
		});
		client.emit = (() => {}) as any;

		const network = client.networkFromConfig({
			...commonNetworkConfig,
			channels: [{name: "#test"}],
		});
		client.networks = [network];

		const chan = network.channels.find((c) => c.name === "#test")!;
		chan.messages = [1, 2, 3].map(
			(i) =>
				new Msg({
					id: i,
					time: 1000 * i,
					text: `live ${i}`,
				})
		);

		// The anchor id is unknown in memory (evicted by the scrollback
		// cap), so more() pages backwards from the stable storage id.
		// Two older messages in the database, nothing more behind them.
		client.messageProvider = {
			isEnabled: true,
			getMessagesAround: () => ({
				messages: [
					new Msg({id: 101, time: 500, text: "older 1"}),
					new Msg({id: 102, time: 900, text: "older 2"}),
				],
				hasMoreBefore: false,
				hasMoreAfter: false,
			}),
		} as any;

		const history = client.more({
			target: chan.id,
			lastId: 9999,
			storageId: 50,
			condensed: false,
		});

		expect(history).to.not.be.null;
		expect(history!.messages.map((m) => m.text)).to.have.ordered.members([
			"older 1",
			"older 2",
		]);
		// Prepended to the server-side buffer...
		expect(chan.messages.map((m) => m.text)).to.have.ordered.members([
			"older 1",
			"older 2",
			"live 1",
			"live 2",
			"live 3",
		]);
		// ...and reported as a final page (nothing older remains)
		expect(history!.moreHistoryAvailable).to.be.false;
	});

	it("should cap the scrollback buffer in more()", function () {
		const manager = new ClientManager();
		const client = new Client(manager, "test", {
			log: false,
			password: "foo",
			sessions: {},
			clientSettings: {},
			networks: [],
		});
		client.emit = (() => {}) as any;

		const network = client.networkFromConfig({
			...commonNetworkConfig,
			channels: [{name: "#test"}],
		});
		client.networks = [network];

		const chan = network.channels.find((c) => c.name === "#test")!;
		chan.messages = Array.from(
			{length: 250},
			(_, i) =>
				new Msg({
					id: 1000 + i,
					time: 100000 + i,
					text: `cached ${i}`,
				})
		);

		client.messageProvider = {
			isEnabled: true,
			getMessagesAround: () => ({
				messages: Array.from(
					{length: 100},
					(_, i) =>
						new Msg({
							id: 2000 + i,
							time: 100 + i,
							text: `paged ${i}`,
						})
				),
				hasMoreBefore: true,
				hasMoreAfter: false,
			}),
		} as any;

		const history = client.more({
			target: chan.id,
			lastId: 9999,
			storageId: 50,
			condensed: false,
		});

		expect(history!.messages).to.have.lengthOf(100);
		expect(history!.moreHistoryAvailable).to.be.true;
		// 250 + 100 prepended, capped to 3x100
		expect(chan.messages.length).to.equal(300);
	});

	it("should load a window around a message in historyAround()", function () {
		const manager = new ClientManager();
		const client = new Client(manager, "test", {
			log: false,
			password: "foo",
			sessions: {},
			clientSettings: {},
			networks: [],
		});
		client.emit = (() => {}) as any;

		const network = client.networkFromConfig({
			...commonNetworkConfig,
			channels: [{name: "#test"}],
		});
		client.networks = [network];

		const chan = network.channels.find((c) => c.name === "#test")!;
		chan.messages = [1, 2, 3].map(
			(i) =>
				new Msg({
					id: i,
					time: 1000 * i,
					text: `live ${i}`,
				})
		);

		client.messageProvider = {
			isEnabled: true,
			getMessagesAround: () => ({
				messages: [new Msg({id: 201, time: 1500, text: "stored"})],
				hasMoreBefore: true,
				hasMoreAfter: true,
			}),
		} as any;

		// Storage-backed window preferred when the provider has the row
		const stored = client.historyAround({target: chan.id, storageId: 42});
		expect(stored!.messages.map((m) => m.text)).to.deep.equal(["stored"]);
		expect(stored!.hasMoreBefore).to.be.true;
		expect(stored!.hasMoreAfter).to.be.true;

		// ...otherwise fall back to an in-memory slice around the session id
		client.messageProvider = undefined;
		const memory = client.historyAround({target: chan.id, msgId: 2});
		expect(memory!.messages.map((m) => m.text)).to.have.ordered.members([
			"live 1",
			"live 2",
			"live 3",
		]);
		expect(memory!.hasMoreBefore).to.be.false;
		expect(memory!.hasMoreAfter).to.be.false;

		// Unknown ids resolve to an empty window, never null
		const missing = client.historyAround({target: chan.id, msgId: 999});
		expect(missing!.messages).to.be.empty;
	});

	it("should page newer messages in historyNewer() and return in historyLatest()", function () {
		const manager = new ClientManager();
		const client = new Client(manager, "test", {
			log: false,
			password: "foo",
			sessions: {},
			clientSettings: {},
			networks: [],
		});
		client.emit = (() => {}) as any;

		const network = client.networkFromConfig({
			...commonNetworkConfig,
			channels: [{name: "#test"}],
		});
		client.networks = [network];

		const chan = network.channels.find((c) => c.name === "#test")!;
		chan.messages = [1, 2, 3, 4, 5].map(
			(i) =>
				new Msg({
					id: i,
					time: 1000 * i,
					text: `live ${i}`,
				})
		);

		const newer = client.historyNewer({target: chan.id, lastId: 2});
		expect(newer!.messages.map((m) => m.text)).to.have.ordered.members([
			"live 3",
			"live 4",
			"live 5",
		]);
		expect(newer!.hasMoreAfter).to.be.false;

		const latest = client.historyLatest({target: chan.id});
		expect(latest!.messages).to.have.lengthOf(5);
	});
});
