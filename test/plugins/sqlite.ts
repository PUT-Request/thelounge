import fs from "fs";
import path from "path";
import {expect} from "vitest";
import util from "../util";
import Msg from "../../server/models/msg";
import {MessageType} from "../../shared/types/msg";
import Config from "../../server/config";
import MessageStorage, {
	currentSchemaVersion,
	computeSidecarSyncPlan,
	getMessagesQuery,
	migrations,
	necessaryMigrations,
	rollbacks,
} from "../../server/plugins/messageStorage/sqlite";
import {DatabaseSync} from "node:sqlite";
import {DeletionRequest} from "../../server/plugins/messageStorage/types";

const orig_schema = [
	// Schema version #1
	// DO NOT CHANGE THIS IN ANY WAY, it's needed to properly test migrations
	"CREATE TABLE IF NOT EXISTS options (name TEXT, value TEXT, CONSTRAINT name_unique UNIQUE (name))",
	"CREATE TABLE IF NOT EXISTS messages (network TEXT, channel TEXT, time INTEGER, type TEXT, msg TEXT)",
	"CREATE INDEX IF NOT EXISTS network_channel ON messages (network, channel)",
	"CREATE INDEX IF NOT EXISTS time ON messages (time)",
];

const v1_schema_version = 1520239200;

const v1_dummy_messages = [
	{
		network: "8f650427-79a2-4950-b8af-94088b61b37c",
		channel: "##linux",
		time: 1594845354280,
		type: "message",
		msg: '{"from":{"mode":"","nick":"rascul"},"text":"db on a flash drive doesn\'t sound very nice though","self":false,"highlight":false,"users":[]}',
	},
	{
		network: "8f650427-79a2-4950-b8af-94088b61b37c",
		channel: "##linux",
		time: 1594845357234,
		type: "message",
		msg: '{"from":{"mode":"","nick":"GrandPa-G"},"text":"that\'s the point of changing to make sure.","self":false,"highlight":false,"users":[]}',
	},
	{
		network: "8f650427-79a2-4950-b8af-94088b61b37c",
		channel: "#pleroma-dev",
		time: 1594845358464,
		type: "message",
		msg: '{"from":{"mode":"@","nick":"rinpatch"},"text":"it\'s complicated","self":false,"highlight":false,"users":[]}',
	},
];

describe("SQLite migrations", function () {
	let db: DatabaseSync;

	beforeAll(function () {
		db = new DatabaseSync(":memory:");

		for (const stmt of orig_schema) {
			db.exec(stmt);
		}

		const insert = db.prepare(
			"INSERT INTO messages(network, channel, time, type, msg) VALUES(?, ?, ?, ?, ?)"
		);

		for (const msg of v1_dummy_messages) {
			insert.run(msg.network, msg.channel, msg.time, msg.type, msg.msg);
		}
	});

	afterAll(function () {
		db.close();
	});

	it("has a down migration for every migration", function () {
		expect(migrations.length).to.eq(rollbacks.length);
		expect(migrations.map((m) => m.version)).to.have.ordered.members(
			rollbacks.map((r) => r.version)
		);
	});

	it("has working up-migrations", function () {
		const to_execute = necessaryMigrations(v1_schema_version);
		expect(to_execute.length).to.eq(migrations.length);
		db.exec("BEGIN EXCLUSIVE TRANSACTION");

		for (const stmt of to_execute.map((m) => m.stmts).flat()) {
			db.exec(stmt);
		}

		db.exec("COMMIT TRANSACTION");
	});

	it("migrated database serves getMessages from the index", function () {
		const plan = db
			.prepare(`EXPLAIN QUERY PLAN ${getMessagesQuery}`)
			.all("8f650427-79a2-4950-b8af-94088b61b37c", "##linux", 100) as {detail: string}[];

		const details = plan.map((row) => row.detail).join("\n");
		expect(details).to.include("USING INDEX network_channel_time");
		expect(details).to.not.include("TEMP B-TREE");
	});

	it("has working down-migrations", function () {
		db.exec("BEGIN EXCLUSIVE TRANSACTION");

		for (const rollback of rollbacks.slice().reverse()) {
			if (rollback.rollback_forbidden) {
				throw Error(
					"Try to write a down migration, if you really can't, flip this to a break"
				);
			}

			for (const stmt of rollback.stmts) {
				db.exec(stmt);
			}
		}

		db.exec("COMMIT TRANSACTION");
	});
});

describe("SQLite unit tests", function () {
	let store: MessageStorage;

	beforeEach(function () {
		store = new MessageStorage("testUser");
		store._enable(":memory:");
	});

	afterEach(function () {
		store.close();
	});

	it("deletes messages when asked to", function () {
		const baseDate = new Date();

		const net = {uuid: "testnet"} as any;
		const chan = {name: "#channel"} as any;

		for (let i = 0; i < 14; ++i) {
			store.index(
				net,
				chan,
				new Msg({
					time: dateAddDays(baseDate, -i),
					text: `msg ${i}`,
				})
			);
		}

		const limit = 1;
		const delReq: DeletionRequest = {
			messageTypes: [MessageType.MESSAGE],
			limit: limit,
			olderThanDays: 2,
		};

		let deleted = store.deleteMessages(delReq);
		expect(deleted).to.equal(limit, "number of deleted messages doesn't match");

		let id = 0;
		let messages = store.getMessages(net, chan, () => id++);
		expect(messages.find((m) => m.text === "msg 13")).to.be.undefined; // oldest gets deleted first

		// let's test if it properly cleans now
		delReq.limit = 100;
		deleted = store.deleteMessages(delReq);
		expect(deleted).to.equal(11, "number of deleted messages doesn't match");
		messages = store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.text)).to.have.ordered.members(["msg 1", "msg 0"]);
	});

	it("deletes only the types it should", function () {
		const baseDate = new Date();

		const net = {uuid: "testnet"} as any;
		const chan = {name: "#channel"} as any;

		for (let i = 0; i < 6; ++i) {
			store.index(
				net,
				chan,
				new Msg({
					time: dateAddDays(baseDate, -i),
					text: `msg ${i}`,
					type: [
						MessageType.ACTION,
						MessageType.AWAY,
						MessageType.JOIN,
						MessageType.PART,
						MessageType.KICK,
						MessageType.MESSAGE,
					][i],
				})
			);
		}

		const delReq: DeletionRequest = {
			messageTypes: [MessageType.ACTION, MessageType.JOIN, MessageType.KICK],
			limit: 100, // effectively no limit
			olderThanDays: 0,
		};

		let deleted = store.deleteMessages(delReq);
		expect(deleted).to.equal(3, "number of deleted messages doesn't match");

		let id = 0;
		let messages = store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.type)).to.have.ordered.members([
			MessageType.MESSAGE,
			MessageType.PART,
			MessageType.AWAY,
		]);

		delReq.messageTypes = [
			MessageType.JOIN, // this is not in the remaining set, just here as a dummy
			MessageType.PART,
			MessageType.MESSAGE,
		];
		deleted = store.deleteMessages(delReq);
		expect(deleted).to.equal(2, "number of deleted messages doesn't match");
		messages = store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.type)).to.have.ordered.members([MessageType.AWAY]);
	});

	it("assigns stable storage ids on index and read", function () {
		const net = {uuid: "sid-test-network"} as any;
		const chan = {name: "#channel"} as any;

		store.index(net, chan, new Msg({time: 1000, text: "first"} as any));
		store.index(net, chan, new Msg({time: 2000, text: "second"} as any));

		// storageId lands at flush time, at most a batch-timeout after index()
		store.flushBatch();

		let id = 0;
		const messages = store.getMessages(net, chan, () => id++);
		expect(messages.map((m) => m.storageId)).to.deep.equal([1, 2]);

		const search = store.search({
			searchTerm: "second",
			networkUuid: "sid-test-network",
			channelName: "#channel",
			offset: 0,
		});
		expect(search.results).to.have.lengthOf(1);
		expect(search.results[0].storageId).to.equal(2);
	});

	it("loads a window around a storage id", function () {
		const net = {uuid: "window-test-network"} as any;
		const chan = {name: "#channel"} as any;

		for (let i = 0; i < 5; ++i) {
			store.index(net, chan, new Msg({time: 1000 * (i + 1), text: `win ${i}`} as any));
		}

		store.flushBatch();

		let id = 0;
		const nextID = () => id++;

		// Middle of history: one message each side plus both "more" flags
		let window = store.getMessagesAround(net, chan, 3, 1, 1, nextID)!;
		expect(window.messages.map((m) => m.text)).to.have.ordered.members([
			"win 1",
			"win 2",
			"win 3",
		]);
		expect(window.hasMoreBefore).to.be.true;
		expect(window.hasMoreAfter).to.be.true;
		expect(window.messages.map((m) => m.storageId)).to.deep.equal([2, 3, 4]);

		// At the oldest edge: nothing before
		window = store.getMessagesAround(net, chan, 1, 10, 1, nextID)!;
		expect(window.messages.map((m) => m.text)).to.have.ordered.members(["win 0", "win 1"]);
		expect(window.hasMoreBefore).to.be.false;
		expect(window.hasMoreAfter).to.be.true;

		// At the newest edge: nothing after
		window = store.getMessagesAround(net, chan, 5, 1, 10, nextID)!;
		expect(window.messages.map((m) => m.text)).to.have.ordered.members(["win 3", "win 4"]);
		expect(window.hasMoreBefore).to.be.true;
		expect(window.hasMoreAfter).to.be.false;

		// Unknown row id, or another channel's row id: no window
		expect(store.getMessagesAround(net, chan, 999, 1, 1, nextID)).to.be.null;
		expect(store.getMessagesAround({uuid: "other-network"} as any, chan, 3, 1, 1, nextID)).to.be
			.null;
	});

	it("bounds getMessages with beforeTime", function () {
		const net = {uuid: "bounded-test-network"} as any;
		const chan = {name: "#channel"} as any;

		for (let i = 0; i < 3; ++i) {
			store.index(net, chan, new Msg({time: 1000 * (i + 1), text: `bound ${i}`} as any));
		}

		let id = 0;
		const messages = store.getMessages(net, chan, () => id++, 2000);
		expect(messages.map((m) => m.text)).to.have.ordered.members(["bound 0", "bound 1"]);
	});
});

describe("SQLite FTS sidecar", function () {
	let store: MessageStorage;

	beforeEach(function () {
		store = new MessageStorage("testUser");
		store._enable(":memory:");
	});

	afterEach(function () {
		store.close();
	});

	function indexMessage(text: string, nick = "bob", time = 123456789) {
		store.index(
			{uuid: "fts-test-network"} as any,
			{name: "#channel"} as any,
			new Msg({
				time,
				text,
				from: {nick, mode: ""},
			} as any)
		);
	}

	function doSearch(searchTerm: string) {
		return store.search({
			searchTerm,
			networkUuid: "fts-test-network",
			channelName: "#channel",
			offset: 0,
		});
	}

	function ftsCount(): number {
		return (
			store.database.prepare("SELECT COUNT(*) as c FROM fts.messages_fts").get() as {
				c: number;
			}
		).c;
	}

	it("computes append vs rebuild sync plans", function () {
		// Empty/fresh database: nothing to do, append from the start
		expect(
			computeSidecarSyncPlan({mainCount: 0, ftsCount: 0, ftsMaxRowid: 0, prefixCount: 0})
		).to.deep.equal({action: "append", fromId: 0});
		// In sync, or sidecar just behind: cheap append of the tail
		expect(
			computeSidecarSyncPlan({mainCount: 10, ftsCount: 10, ftsMaxRowid: 10, prefixCount: 10})
		).to.deep.equal({action: "append", fromId: 10});
		expect(
			computeSidecarSyncPlan({mainCount: 12, ftsCount: 10, ftsMaxRowid: 10, prefixCount: 10})
		).to.deep.equal({action: "append", fromId: 10});
		// Deletion inside the indexed range: only a full rebuild is safe
		expect(
			computeSidecarSyncPlan({mainCount: 10, ftsCount: 10, ftsMaxRowid: 12, prefixCount: 9})
		).to.deep.equal({action: "rebuild", fromId: 0});
	});

	it("searches batched messages without an explicit flush", function () {
		indexMessage("hello world");
		// No flushBatch() call: search() must flush pending writes itself
		expect(doSearch("hello").results.map((m) => m.text)).to.deep.equal(["hello world"]);
		expect(ftsCount()).to.equal(1);
	});

	it("does not index non-message types", function () {
		store.index(
			{uuid: "fts-test-network"} as any,
			{name: "#channel"} as any,
			new Msg({time: 123456789, text: "someone joined", type: MessageType.JOIN} as any)
		);
		indexMessage("a real message");
		store.flushBatch();
		expect(ftsCount()).to.equal(1);
		expect(doSearch("someone").results).to.be.empty;
	});

	it("filters by from: nick", function () {
		indexMessage("hello from alice", "alice");
		indexMessage("hello from bob", "bob");
		expect(doSearch("hello from:alice").results.map((m) => m.text)).to.deep.equal([
			"hello from alice",
		]);
		expect(doSearch("hello from:BOB").results.map((m) => m.text)).to.deep.equal([
			"hello from bob",
		]);
	});

	it("filters by datebefore:/dateafter:", function () {
		indexMessage("old message", "bob", 1000);
		indexMessage("new message", "bob", 2000);
		expect(
			doSearch("message dateafter:1970-01-01T00:00:01.500Z").results.map((m) => m.text)
		).to.deep.equal(["new message"]);
		expect(
			doSearch("message datebefore:1970-01-01T00:00:01.500Z").results.map((m) => m.text)
		).to.deep.equal(["old message"]);
		// Invalid dates are left in the search term instead of filtering
		expect(doSearch("message datebefore:not-a-date").results).to.be.empty;
	});

	it("supports date-only queries for the jump-to-date picker", function () {
		indexMessage("old message", "bob", 1000);
		indexMessage("new message", "bob", 2000);
		expect(
			doSearch(
				"dateafter:1970-01-01T00:00:01.500Z datebefore:1970-01-01T00:00:03Z"
			).results.map((m) => m.text)
		).to.deep.equal(["new message"]);
	});

	it("treats FTS keywords in the term as literals", function () {
		indexMessage("bread AND butter");
		indexMessage("bread OR butter");
		// Would be a MATCH syntax error or an operator if interpolated raw
		expect(doSearch("bread AND butter").results.map((m) => m.text)).to.deep.equal([
			"bread AND butter",
		]);
	});

	it("falls back to a full scan for short terms", function () {
		indexMessage("abc de");
		indexMessage("abc xyz");
		// "de" is too short for the trigram prefilter: LIKE still finds it
		expect(doSearch("de").results.map((m) => m.text)).to.deep.equal(["abc de"]);
	});

	it("rebuilds the sidecar when rows were deleted out from under it", function () {
		indexMessage("alpha one");
		indexMessage("alpha two");
		indexMessage("alpha three");
		store.flushBatch();
		// Simulate an external delete (e.g. another build writing the main file)
		store.database
			.prepare("DELETE FROM messages WHERE id = (SELECT MAX(id) FROM messages)")
			.run();
		store.reconcileSidecar();
		expect(doSearch("alpha").results.map((m) => m.text)).to.have.lengthOf(2);
		expect(ftsCount()).to.equal(2);
	});

	it("appends the missing tail when the sidecar is only behind", function () {
		indexMessage("beta one");
		store.flushBatch();
		indexMessage("beta two");
		store.flushBatch();
		// Simulate a missed tail: drop the newest FTS row only
		store.database
			.prepare(
				"DELETE FROM fts.messages_fts WHERE rowid = (SELECT MAX(rowid) FROM fts.messages_fts)"
			)
			.run();
		store.reconcileSidecar();
		expect(doSearch("beta").results.map((m) => m.text)).to.have.lengthOf(2);
		expect(ftsCount()).to.equal(2);
	});

	it("keeps the sidecar in sync on deleteMessages and deleteChannel", function () {
		indexMessage("gamma one", "bob", 100);
		indexMessage("gamma two", "bob", 200);
		indexMessage("gamma three", "bob", 300);

		const deleted = store.deleteMessages({
			messageTypes: [MessageType.MESSAGE],
			limit: 2,
			olderThanDays: 0,
		});
		expect(deleted).to.equal(2);
		expect(doSearch("gamma").results.map((m) => m.text)).to.deep.equal(["gamma three"]);
		expect(ftsCount()).to.equal(1);

		store.index(
			{uuid: "fts-test-network"} as any,
			{name: "#other"} as any,
			new Msg({time: 400, text: "gamma other", from: {nick: "bob", mode: ""}} as any)
		);
		store.deleteChannel({uuid: "fts-test-network"} as any, {name: "#channel"} as any);
		expect(doSearch("gamma").results).to.be.empty;
		expect(
			store
				.search({
					searchTerm: "gamma",
					networkUuid: "fts-test-network",
					channelName: "#other",
					offset: 0,
				})
				.results.map((m) => m.text)
		).to.deep.equal(["gamma other"]);
	});

	it("deletes more ids than fit in one chunk", function () {
		const net = {uuid: "fts-test-network"} as any;
		const chan = {name: "#channel"} as any;

		for (let i = 0; i < 600; ++i) {
			store.index(net, chan, new Msg({time: 1000 + i, text: `bulk ${i}`} as any));
		}

		// -1 means unlimited (what the storage cleaner passes)
		const deleted = store.deleteMessages({
			messageTypes: null,
			limit: -1,
			olderThanDays: 0,
		});
		expect(deleted).to.equal(600);
		expect(
			store.search({
				searchTerm: "bulk",
				networkUuid: "fts-test-network",
				channelName: "#channel",
				offset: 0,
			}).results
		).to.be.empty;
		expect(ftsCount()).to.equal(0);
	});

	it("reports storage stats", function () {
		const net = {uuid: "stats-test-network"} as any;

		store.index(net, {name: "#one"} as any, new Msg({time: 1000, text: "hello"} as any));
		store.index(net, {name: "#one"} as any, new Msg({time: 2000, text: "world"} as any));
		store.index(net, {name: "#two"} as any, new Msg({time: 3000, text: "hello again"} as any));

		const stats = store.getStats();

		expect(stats.messageCount).to.equal(3);
		expect(stats.ftsCount).to.equal(3);
		expect(stats.channels.map((c) => [c.channel, c.messages])).to.deep.equal([
			["#one", 2],
			["#two", 1],
		]);
	});

	it("writes consistent backups", function () {
		const net = {uuid: "backup-test-network"} as any;

		store.index(
			net,
			{name: "#channel"} as any,
			new Msg({time: 1000, text: "backup me"} as any)
		);
		store.flushBatch();

		const dir = path.join(Config.getHomePath(), "logs", "backup-test-tmp");
		const {main, sidecar} = store.backupTo(dir);

		expect(fs.existsSync(main)).to.be.true;
		expect(fs.existsSync(sidecar)).to.be.true;

		// The backup is a working database with the same content
		const restored = new MessageStorage("restored");
		restored._enable(main);

		let id = 0;
		const messages = restored.getMessages(net, {name: "#channel"} as any, () => id++);
		expect(messages.map((m) => m.text)).to.deep.equal(["backup me"]);

		const stats = restored.getStats();
		expect(stats.messageCount).to.equal(1);
		expect(stats.ftsCount).to.equal(1);

		restored.close();
		fs.unlinkSync(main);
		fs.unlinkSync(sidecar);
		fs.rmdirSync(dir);
	});
});

describe("SQLite Message Storage", function () {
	const expectedPath = path.join(Config.getHomePath(), "logs", "testUser.sqlite3");
	const expectedSidecarPath = path.join(Config.getHomePath(), "logs", "testUser.fts.sqlite3");
	let store: MessageStorage;

	beforeAll(function () {
		store = new MessageStorage("testUser");

		// Delete database files from previous test run
		if (fs.existsSync(expectedPath)) {
			fs.unlinkSync(expectedPath);
		}

		if (fs.existsSync(expectedSidecarPath)) {
			fs.unlinkSync(expectedSidecarPath);
		}
	});

	afterAll(function () {
		// After tests run, remove the logs folder
		// so we return to the clean state
		fs.unlinkSync(expectedPath);

		if (fs.existsSync(expectedSidecarPath)) {
			fs.unlinkSync(expectedSidecarPath);
		}

		fs.rmdirSync(path.join(Config.getHomePath(), "logs"));
	});

	it("should create database file", function () {
		expect(store.isEnabled).to.be.false;
		expect(fs.existsSync(expectedPath)).to.be.false;

		store.enable();
		expect(store.isEnabled).to.be.true;
	});

	it("should resolve an empty array when disabled", function () {
		store.isEnabled = false;
		const messages = store.getMessages(null as any, null as any, null as any);
		expect(messages).to.be.empty;
		store.isEnabled = true;
	});

	it("should insert schema version to options table", function () {
		const row = store.database
			.prepare("SELECT value FROM options WHERE name = 'schema_version'")
			.get() as {value: string};
		expect(row.value).to.equal(currentSchemaVersion.toString());
	});

	it("should insert migrations", function () {
		const row = store.database
			.prepare("SELECT id, version FROM migrations WHERE version = ?")
			.get(currentSchemaVersion) as {id: number; version: number} | undefined;
		expect(row).to.not.be.undefined;
	});

	it("should store a message", function () {
		store.index(
			{
				uuid: "this-is-a-network-guid",
			} as any,
			{
				name: "#thisISaCHANNEL",
			} as any,
			new Msg({
				time: 123456789,
				text: "Hello from sqlite world!",
			} as any)
		);
	});

	it("should retrieve previously stored message", function () {
		let msgid = 0;
		const messages = store.getMessages(
			{
				uuid: "this-is-a-network-guid",
			} as any,
			{
				name: "#thisisaCHANNEL",
			} as any,
			() => msgid++
		);
		expect(messages).to.have.lengthOf(1);
		const msg = messages[0];
		expect(msg.text).to.equal("Hello from sqlite world!");
		expect(msg.type).to.equal(MessageType.MESSAGE);
		expect(msg.time.getTime()).to.equal(123456789);
	});

	it("should retrieve latest LIMIT messages in order", function () {
		const originalMaxHistory = Config.values.maxHistory;

		try {
			Config.values.maxHistory = 2;

			for (let i = 0; i < 200; ++i) {
				store.index(
					{uuid: "retrieval-order-test-network"} as any,
					{name: "#channel"} as any,
					new Msg({
						time: 123456789 + i,
						text: `msg ${i}`,
					} as any)
				);
			}

			let msgId = 0;
			const messages = store.getMessages(
				{uuid: "retrieval-order-test-network"} as any,
				{name: "#channel"} as any,
				() => msgId++
			);
			expect(messages).to.have.lengthOf(2);
			expect(messages.map((i_1) => i_1.text)).to.deep.equal(["msg 198", "msg 199"]);
		} finally {
			Config.values.maxHistory = originalMaxHistory;
		}
	});

	it("getMessages uses the index instead of sorting the whole channel", function () {
		// #5103
		const plan = store.database
			.prepare(`EXPLAIN QUERY PLAN ${getMessagesQuery}`)
			.all("retrieval-order-test-network", "#channel", 10000) as {detail: string}[];

		const details = plan.map((row) => row.detail).join("\n");
		expect(details).to.include("USING INDEX network_channel_time");
		expect(details).to.not.include("TEMP B-TREE");
	});

	it("should search messages", function () {
		const originalMaxHistory = Config.values.maxHistory;

		try {
			Config.values.maxHistory = 2;

			const search = store.search({
				searchTerm: "msg",
				networkUuid: "retrieval-order-test-network",
				channelName: "",
				offset: 0,
			});
			expect(search.results).to.have.lengthOf(100);
			const expectedMessages: string[] = [];

			for (let i = 100; i < 200; ++i) {
				expectedMessages.push(`msg ${i}`);
			}

			expect(search.results.map((i_1) => i_1.text)).to.deep.equal(expectedMessages);
		} finally {
			Config.values.maxHistory = originalMaxHistory;
		}
	});

	it("should search messages with escaped wildcards", function () {
		function assertResults(query: string, expected: string[]) {
			const search = store.search({
				searchTerm: query,
				networkUuid: "this-is-a-network-guid2",
				channelName: "",
				offset: 0,
			});
			expect(search.results.map((i) => i.text)).to.deep.equal(expected);
		}

		const originalMaxHistory = Config.values.maxHistory;

		try {
			Config.values.maxHistory = 3;

			store.index(
				{uuid: "this-is-a-network-guid2"} as any,
				{name: "#channel"} as any,
				new Msg({
					time: 123456790,
					text: `foo % bar _ baz`,
				} as any)
			);

			store.index(
				{uuid: "this-is-a-network-guid2"} as any,
				{name: "#channel"} as any,
				new Msg({
					time: 123456791,
					text: `foo bar x baz`,
				} as any)
			);

			store.index(
				{uuid: "this-is-a-network-guid2"} as any,
				{name: "#channel"} as any,
				new Msg({
					time: 123456792,
					text: `bar @ baz`,
				} as any)
			);

			assertResults("foo", ["foo % bar _ baz", "foo bar x baz"]);
			assertResults("%", ["foo % bar _ baz"]);
			assertResults("foo % bar ", ["foo % bar _ baz"]);
			assertResults("_", ["foo % bar _ baz"]);
			assertResults("bar _ baz", ["foo % bar _ baz"]);
			assertResults("%%", []);
			assertResults("@%", []);
			assertResults("@", ["bar @ baz"]);
		} finally {
			Config.values.maxHistory = originalMaxHistory;
		}
	});

	it("should be able to downgrade", function () {
		for (const rollback of rollbacks.slice().reverse()) {
			if (rollback.rollback_forbidden) {
				throw Error(
					"Try to write a down migration, if you really can't, flip this to a break"
				);
			}

			const new_version = store.downgrade_to(rollback.version);
			expect(new_version).to.equal(rollback.version);
		}
	});

	it("should close database", function () {
		store.close();
		expect(fs.existsSync(expectedPath)).to.be.true;
	});
});

function dateAddDays(date: Date, days: number) {
	const ret = new Date(date.valueOf());
	ret.setDate(date.getDate() + days);
	return ret;
}
