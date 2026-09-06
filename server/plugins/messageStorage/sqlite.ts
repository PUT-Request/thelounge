import {DatabaseSync} from "node:sqlite";

import log from "../../log";
import path from "path";
import {mkdirSync, statSync, unlinkSync} from "fs";
import Config from "../../config";
import Msg, {Message} from "../../models/msg";
import Chan, {Channel} from "../../models/chan";
import Helper from "../../helper";
import type {SearchableMessageStorage, DeletionRequest} from "./types";
import Network from "../../models/network";
import {SearchQuery, SearchResponse} from "../../../shared/types/storage";
import {MessageType} from "../../../shared/types/msg";

type Migration = {version: number; stmts: string[]};
type Rollback = {version: number; rollback_forbidden?: boolean; stmts: string[]};

export const currentSchemaVersion = 1784073600000; // use `new Date().getTime()`

// Desired schema, adapt to the newest version and add migrations to the array below
const schema = [
	"CREATE TABLE options (name TEXT, value TEXT, CONSTRAINT name_unique UNIQUE (name))",
	"CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT, channel TEXT, time INTEGER, type TEXT, msg TEXT, msgid TEXT)",
	`CREATE TABLE migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version INTEGER NOT NULL UNIQUE,
		rollback_forbidden INTEGER DEFAULT 0 NOT NULL
	)`,
	`CREATE TABLE rollback_steps (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		migration_id INTEGER NOT NULL REFERENCES migrations ON DELETE CASCADE,
		step INTEGER NOT NULL,
		statement TEXT NOT NULL
	)`,
	"CREATE INDEX time ON messages (time)",
	"CREATE INDEX msg_type_idx on messages (type)", // needed for efficient storageCleaner queries
	// needed for efficient getMessages queries
	"CREATE INDEX network_channel_time ON messages (network, channel, time)",
	"CREATE INDEX msgid_idx ON messages (msgid)",
];

// the migrations will be executed in an exclusive transaction as a whole
// add new migrations to the end, with the version being the new 'currentSchemaVersion'
// write a corresponding down migration into rollbacks
export const migrations: Migration[] = [
	{
		version: 1672236339873,
		stmts: [
			"CREATE TABLE messages_new (id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT, channel TEXT, time INTEGER, type TEXT, msg TEXT)",
			"INSERT INTO messages_new(network, channel, time, type, msg) select network, channel, time, type, msg from messages order by time asc",
			"DROP TABLE messages",
			"ALTER TABLE messages_new RENAME TO messages",
			"CREATE INDEX network_channel ON messages (network, channel)",
			"CREATE INDEX time ON messages (time)",
		],
	},
	{
		version: 1679743888000,
		stmts: [
			`CREATE TABLE IF NOT EXISTS migrations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				version INTEGER NOT NULL UNIQUE,
				rollback_forbidden INTEGER DEFAULT 0 NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS rollback_steps (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				migration_id INTEGER NOT NULL REFERENCES migrations ON DELETE CASCADE,
				step INTEGER NOT NULL,
				statement TEXT NOT NULL
			)`,
		],
	},
	{
		version: 1703322560448,
		stmts: ["CREATE INDEX msg_type_idx on messages (type)"],
	},
	{
		// replaces network_channel and also covers the sort in getMessages
		version: 1780272000000,
		stmts: [
			"CREATE INDEX IF NOT EXISTS network_channel_time ON messages (network, channel, time)",
			"DROP INDEX IF EXISTS network_channel",
		],
	},
	{
		version: 1784073600000,
		stmts: [
			"ALTER TABLE messages ADD COLUMN msgid TEXT",
			"CREATE INDEX msgid_idx ON messages (msgid)",
		],
	},
];

// down migrations need to restore the state of the prior version.
// rollback can be disallowed by adding rollback_forbidden: true to it
export const rollbacks: Rollback[] = [
	{
		version: 1672236339873,
		stmts: [], // changes aren't visible, left empty on purpose
	},
	{
		version: 1679743888000,
		stmts: [], // here we can't drop the tables, as we use them in the code, so just leave those in
	},
	{
		version: 1703322560448,
		stmts: ["drop INDEX msg_type_idx"],
	},
	{
		version: 1780272000000,
		stmts: [
			"DROP INDEX IF EXISTS network_channel_time",
			"CREATE INDEX IF NOT EXISTS network_channel ON messages (network, channel)",
		],
	},
	{
		version: 1784073600000,
		stmts: ["DROP INDEX msgid_idx", "ALTER TABLE messages DROP COLUMN msgid"],
	},
];

// Sidecar-scoped schema for the FTS index - never touches the main .sqlite3 file.
// The sidecar is disposable (safe to delete; gets rebuilt from `messages` on
// the next enable()), so its own migration bookkeeping lives inside itself:
// deleting the sidecar and resetting fts_ext_version to 0 are the same
// event by construction, with no extra invariant to maintain elsewhere.
const ftsSchema = [
	"CREATE TABLE IF NOT EXISTS fts.fts_options (name TEXT, value TEXT, CONSTRAINT name_unique UNIQUE (name))",
	// FTS5 trigram index over message text, so search() can narrow candidates
	// through the index instead of scanning every stored message.
	// Not an external-content table: FTS5's automatic content lookup requires a
	// same-named column in the content table, but text lives inside the main
	// file's msg JSON blob, so rowid is keyed to messages.id explicitly and the
	// main row is always re-read for the authoritative content.
	// NOTE: no detail=none here on purpose. detail=none forbids every MATCH
	// query except single short-trigram lookups, which makes the index
	// unusable as a prefilter; LIKE against the FTS table alone was measured
	// slower than the old json_extract scan (extra join + sort, same full
	// scan). Full detail costs more disk but is what makes MATCH work.
	"CREATE VIRTUAL TABLE IF NOT EXISTS fts.messages_fts USING fts5(text, tokenize='trigram')",
];

// Extensible migration path for anything sidecar-scoped - evolves
// independently of currentSchemaVersion above. Baseline only for now
// (ftsSchema above creates the v1 shape directly, mirroring how
// setup_new_db() uses `schema` directly rather than replaying
// migrations[0]); add future entries here the same way `migrations`
// grows, e.g. to change the FTS tokenizer.
export const ftsCurrentVersion = 1;
export const ftsMigrations: Migration[] = [{version: 1, stmts: []}];
export const ftsRollbacks: Rollback[] = [{version: 1, stmts: []}];

type BatchedMessage = {
	network: string;
	channel: string;
	time: number;
	type: string;
	msg: string;
	msgid: string | null;
	// Pre-extracted searchable text, captured here at push time so
	// flushBatch() can write straight into the sidecar FTS table without a
	// SQL round-trip. Only meaningful for type === 'message'.
	text: string | null;
	// The live Msg object the row was queued from. flushBatch() stamps its
	// storageId once the rowid is known, so in-memory messages (and anything
	// referencing them, like mentions) can later be jumped to by stable id.
	source: Msg;
};

type StoredRow = {
	id: number;
	msg: string;
	type: string;
	time: number;
	msgid: string | null;
	network?: string;
	channel?: string;
};

type MessageWindow = {
	messages: Message[];
	hasMoreBefore: boolean;
	hasMoreAfter: boolean;
};

export type ChannelStats = {
	network: string;
	channel: string;
	messages: number;
};

export type StorageStats = {
	mainPath: string;
	mainBytes: number;
	sidecarPath: string;
	sidecarBytes: number;
	messageCount: number;
	ftsCount: number;
	channels: ChannelStats[];
};

// Queries slower than this are worth knowing about: with multi-million-row
// histories even an indexed query can surprise (e.g. a match-everything
// term that must sort before LIMIT applies).
const SLOW_QUERY_MS = 1000;

type SidecarSyncCounts = {
	mainCount: number;
	ftsCount: number;
	ftsMaxRowid: number;
	prefixCount: number;
};

type SidecarSyncPlan = {action: "append" | "rebuild"; fromId: number};

// Chunk size for multi-id deletes: safely under both the JS engine's
// per-call argument limit and SQLite's variable-number limit, even when the
// storage cleaner passes limit -1 (unlimited).
const deleteIdChunkSize = 500;

// Pure decision function (no I/O) so it's independently unit-testable.
// messages.id is a true AUTOINCREMENT column (ids are never reused after a
// delete), which is what makes this sound: every row ever present in
// messages_fts was inserted with rowid set to some id that was, at insertion
// time, a real type='message' row, so none of them can exceed ftsMaxRowid.
// If prefixCount (live type='message' rows with id <= ftsMaxRowid) equals
// ftsCount, the two sets have equal cardinality within a range whose
// membership can't silently swap identities - sufficient to conclude set
// equality without an explicit per-id diff, and license the cheap append
// path instead of a full rebuild. A mismatch means something was deleted
// (or otherwise changed) within the already-indexed range, which can only
// be safely recovered by a full rescan.
/**
 * Decides whether the FTS sidecar needs a cheap append or a full rebuild.
 *
 * Pure and total: no I/O and never throws, safe to call concurrently.
 *
 * @param counts Row counts describing main vs sidecar state.
 * @returns Sync plan with the row id to resume from.
 */
export function computeSidecarSyncPlan(counts: SidecarSyncCounts): SidecarSyncPlan {
	if (counts.prefixCount !== counts.ftsCount) {
		return {action: "rebuild", fromId: 0};
	}

	return {action: "append", fromId: counts.ftsMaxRowid};
}

// exported for tests
export const getMessagesQuery =
	"SELECT id, msg, type, time, msgid FROM messages WHERE network = ? AND channel = ? ORDER BY time DESC, id DESC LIMIT ?";

class SqliteMessageStorage implements SearchableMessageStorage {
	isEnabled: boolean;
	database!: DatabaseSync;
	userName: string;
	mainPath: string | null = null;
	sidecarPath: string | null = null;

	// Message batching for improved write performance
	private batchQueue: BatchedMessage[] = [];
	private batchSize = 50; // Flush after 50 messages
	private batchTimeout = 1000; // Flush after 1 second
	private batchTimer: NodeJS.Timeout | null = null;
	private insertStmt: ReturnType<DatabaseSync["prepare"]> | null = null;
	private ftsInsertStmt: ReturnType<DatabaseSync["prepare"]> | null = null;

	constructor(userName: string) {
		this.userName = userName;
		this.isEnabled = false;
	}

	private sidecarPathFor(connection_string: string): string {
		if (connection_string === ":memory:") {
			return ":memory:";
		}

		const dir = path.dirname(connection_string);
		const base = path.basename(connection_string, ".sqlite3");
		return path.join(dir, `${base}.fts.sqlite3`);
	}

	_enable(connection_string: string) {
		this.database = new DatabaseSync(connection_string);
		this.mainPath = connection_string;

		try {
			this.run_pragmas();

			const sidecarPath = this.sidecarPathFor(connection_string);
			this.sidecarPath = sidecarPath;
			this.database.prepare("ATTACH DATABASE ? AS fts").run(sidecarPath);
			this.database.exec("PRAGMA fts.journal_mode = DELETE;");

			this.ensureSidecarSchema();
			this.run_migrations();
			this.reconcileSidecar();

			// Prepare insert statements for batching
			this.insertStmt = this.database.prepare(
				"INSERT INTO messages(network, channel, time, type, msg, msgid) VALUES(?, ?, ?, ?, ?, ?)"
			);
			this.ftsInsertStmt = this.database.prepare(
				"INSERT INTO fts.messages_fts(rowid, text) VALUES (?, ?)"
			);
		} catch (e) {
			this.isEnabled = false;
			throw Helper.catch_to_error("Migration failed", e);
		}

		this.isEnabled = true;
	}

	enable() {
		const logsPath = Config.getUserLogsPath();
		const sqlitePath = path.join(logsPath, `${this.userName}.sqlite3`);
		mkdirSync(logsPath, {recursive: true});
		this._enable(sqlitePath);
	}

	setup_new_db() {
		for (const stmt of schema) {
			this.database.exec(stmt);
		}

		this.database
			.prepare("INSERT INTO options (name, value) VALUES ('schema_version', ?)")
			.run(currentSchemaVersion.toString());
	}

	current_version(): number {
		const have_options = this.database
			.prepare("select 1 from sqlite_master where type = 'table' and name = 'options'")
			.get();

		if (!have_options) {
			return 0;
		}

		const version = this.database
			.prepare("SELECT value FROM options WHERE name = 'schema_version'")
			.get() as {value: string} | undefined;

		if (version === undefined) {
			// technically shouldn't happen, means something created a schema but didn't populate it
			// we'll try our best to recover
			return 0;
		}

		const storedSchemaVersion = parseInt(version.value, 10);
		return storedSchemaVersion;
	}

	update_version_in_db(version: number = currentSchemaVersion) {
		// Defaults to currentSchemaVersion for the upgrade path, which always
		// migrates up to the running build's version. _downgrade_to passes its
		// own target explicitly: falling back to currentSchemaVersion there
		// would drop the schema objects but mislabel the DB as still current,
		// so older code would refuse to start while our own upgrade path
		// would see nothing to do and never recreate what was dropped.
		this.database
			.prepare("UPDATE options SET value = ? WHERE name = 'schema_version'")
			.run(version.toString());
	}

	run_pragmas() {
		// Deliberately NOT WAL: writes now span both this file and the
		// attached FTS sidecar in a single transaction (flushBatch, deletes),
		// and SQLite's cross-database ATTACH transactions are only atomic
		// when none of the participating databases are in WAL mode - WAL's
		// per-file log has no cross-file equivalent to the classic
		// rollback-journal mode's multi-file super-journal coordination.
		// WAL's actual benefit (concurrent readers not blocked by a writer)
		// has no real payoff here anyway: one connection per user, one
		// process, nothing else contends for the file. FULL synchronous
		// (rather than WAL-safe NORMAL) is required in lockstep for the same
		// reason - NORMAL's corruption-safety guarantee specifically depends
		// on WAL.
		this.database.exec("PRAGMA journal_mode = DELETE;");
		this.database.exec("PRAGMA synchronous = FULL;");
	}

	// Sidecar's own schema + tiny independent migration pass, keyed on
	// fts_ext_version rather than schema_version.
	ensureSidecarSchema() {
		for (const stmt of ftsSchema) {
			this.database.exec(stmt);
		}

		const row = this.database
			.prepare("SELECT value FROM fts.fts_options WHERE name = 'fts_ext_version'")
			.get() as {value: string} | undefined;

		if (row === undefined) {
			this.database
				.prepare("INSERT INTO fts.fts_options (name, value) VALUES ('fts_ext_version', ?)")
				.run(ftsCurrentVersion.toString());
			return;
		}

		const storedVersion = parseInt(row.value, 10);

		if (storedVersion >= ftsCurrentVersion) {
			return;
		}

		const toExecute = ftsMigrations.filter((m) => m.version > storedVersion);

		for (const stmt of toExecute.map((m) => m.stmts).flat()) {
			this.database.exec(stmt);
		}

		this.database
			.prepare("UPDATE fts.fts_options SET value = ? WHERE name = 'fts_ext_version'")
			.run(ftsCurrentVersion.toString());
	}

	// Detects and fixes drift between `messages` and the sidecar's
	// messages_fts (e.g. an older build wrote to the main file without the
	// sidecar attached, or the sidecar was deleted) - see
	// computeSidecarSyncPlan for the detection logic.
	reconcileSidecar() {
		const mainCount = (
			this.database
				.prepare("SELECT COUNT(*) as c FROM messages WHERE type = 'message'")
				.get() as {c: number}
		).c;

		const ftsMaxRowid = (
			this.database
				.prepare("SELECT COALESCE(MAX(rowid), 0) as c FROM fts.messages_fts")
				.get() as {c: number}
		).c;

		const ftsCount = (
			this.database.prepare("SELECT COUNT(*) as c FROM fts.messages_fts").get() as {
				c: number;
			}
		).c;

		const prefixCount = (
			this.database
				.prepare("SELECT COUNT(*) as c FROM messages WHERE type = 'message' AND id <= ?")
				.get(ftsMaxRowid) as {c: number}
		).c;

		if (mainCount === 0 && ftsCount === 0) {
			return; // nothing to do, fast path for the common empty/fresh case
		}

		const plan = computeSidecarSyncPlan({mainCount, ftsCount, ftsMaxRowid, prefixCount});

		if (plan.action === "append") {
			if (mainCount === ftsCount) {
				return; // already in sync, nothing to append
			}

			this.catchUpSidecarAppend(plan.fromId);
		} else {
			this.fullRebuildSidecar();
		}
	}

	// Cheap path: the sidecar is just missing a tail of newer rows (a pure
	// append happened since it was last built/synced) - insert only those.
	catchUpSidecarAppend(fromId: number) {
		log.info(
			`sqlite fts sidecar for ${this.userName} is missing recent messages, catching up.`
		);

		this.database
			.prepare(
				`INSERT INTO fts.messages_fts(rowid, text)
				SELECT id, json_extract(msg, '$.text') FROM messages
				WHERE type = 'message' AND id > ?`
			)
			.run(fromId);

		log.info(`sqlite fts sidecar for ${this.userName} caught up.`);
	}

	// Expensive path: something was deleted (or otherwise changed) within
	// the already-indexed range, so a per-id diff can't be trusted - wipe
	// and rebuild from scratch. Proportional to total message count.
	fullRebuildSidecar() {
		log.info(
			`sqlite fts sidecar for ${this.userName} is out of sync, rebuilding - this can take minutes on large message histories.`
		);

		this.database.exec("DELETE FROM fts.messages_fts");
		this.database.exec(
			`INSERT INTO fts.messages_fts(rowid, text)
			SELECT id, json_extract(msg, '$.text') FROM messages WHERE type = 'message'`
		);

		log.info(`sqlite fts sidecar for ${this.userName} rebuilt.`);
	}

	// Flush batched messages to the database in a single transaction spanning
	// both this file and the attached fts sidecar - genuinely atomic since
	// neither is in WAL mode (see run_pragmas): an error from either insert
	// rolls back both, so the main DB can never end up ahead of the sidecar.
	flushBatch(): void {
		if (this.batchQueue.length === 0) {
			return;
		}

		if (!this.insertStmt || !this.ftsInsertStmt) {
			log.error("Cannot flush batch: insert statement not prepared");
			return;
		}

		const messages = this.batchQueue.splice(0); // Take all messages and clear queue

		this.database.exec("BEGIN");

		try {
			for (const msg of messages) {
				const info = this.insertStmt.run(
					msg.network,
					msg.channel,
					msg.time,
					msg.type,
					msg.msg,
					msg.msgid
				) as unknown as {lastInsertRowid: number | bigint};
				const rowid = Number(info.lastInsertRowid);

				// Stamp the live object with its stable row id, so jumps by
				// storageId work for messages that arrived after the last
				// read (mentions and notifications hold the same reference).
				msg.source.storageId = rowid;

				if (msg.type === (MessageType.MESSAGE as string)) {
					this.ftsInsertStmt.run(rowid, msg.text);
				}
			}
		} catch (err) {
			this.database.exec("ROLLBACK");
			// Re-add messages to queue on failure (concat, not spread -
			// the batch is unbounded between timer flushes)
			this.batchQueue = messages.concat(this.batchQueue);
			throw err;
		}

		this.database.exec("COMMIT");
	}

	// Schedule a batch flush after the timeout, fire-and-forget: errors are
	// logged, and the next flush (size-triggered or read-triggered) retries.
	private scheduleBatchFlush(): void {
		if (this.batchTimer) {
			return; // Timer already scheduled
		}

		this.batchTimer = setTimeout(() => {
			this.batchTimer = null;

			try {
				this.flushBatch();
			} catch (err) {
				log.error(`Batch flush error: ${err instanceof Error ? err.message : String(err)}`);
			}
		}, this.batchTimeout);

		// Don't hold the process open for a pending batch
		this.batchTimer.unref();
	}

	_run_migrations(dbVersion: number) {
		log.info(
			`sqlite messages schema version is out of date (${dbVersion} < ${currentSchemaVersion}). Running migrations, this may take a while.`
		);

		const to_execute = necessaryMigrations(dbVersion);

		for (const stmt of to_execute.map((m) => m.stmts).flat()) {
			this.database.exec(stmt);
		}

		this.update_version_in_db();
	}

	run_migrations() {
		const version = this.current_version();

		if (version > currentSchemaVersion) {
			throw new Error(
				`sqlite messages schema version is higher than expected (${version} > ${currentSchemaVersion}). Is The Lounge out of date?`
			);
		} else if (version === currentSchemaVersion) {
			return; // nothing to do
		}

		this.database.exec("BEGIN EXCLUSIVE TRANSACTION");

		try {
			if (version === 0) {
				this.setup_new_db();
			} else {
				this._run_migrations(version);
			}

			this.insert_rollback_since(version);
		} catch (err) {
			this.database.exec("ROLLBACK");
			throw err;
		}

		this.database.exec("COMMIT");
		this.database.exec("VACUUM");
	}

	// helper method that vacuums the db, meant to be used by migration related cli commands
	vacuum() {
		this.database.exec("VACUUM");
	}

	// Run a query and warn when it is slow enough to matter. The label
	// identifies the call site; the statement itself is not logged since it
	// may contain user search terms.
	private timedAll(label: string, sql: string, ...params: (string | number)[]) {
		const start = process.hrtime.bigint();
		const rows = this.database.prepare(sql).all(...params);
		this.warnIfSlow(label, start);

		return rows;
	}

	private timedGet(label: string, sql: string, ...params: (string | number)[]) {
		const start = process.hrtime.bigint();
		const row = this.database.prepare(sql).get(...params);
		this.warnIfSlow(label, start);

		return row;
	}

	private warnIfSlow(label: string, start: bigint) {
		const ms = Number(process.hrtime.bigint() - start) / 1e6;

		if (ms >= SLOW_QUERY_MS) {
			log.warn(`Slow sqlite query for ${this.userName}: ${label} took ${Math.round(ms)}ms`);
		}
	}

	getStats(): StorageStats {
		this.flushBatch();

		const mainPath = this.mainPath ?? "(unknown)";
		const sidecarPath = this.sidecarPath ?? "(unknown)";

		const sizeOf = (p: string | null) => {
			try {
				return p === null || p === ":memory:" ? 0 : statSync(p).size;
			} catch {
				return 0;
			}
		};

		const messageCount = (
			this.database.prepare("SELECT COUNT(*) as c FROM messages").get() as {c: number}
		).c;
		const ftsCount = (
			this.database.prepare("SELECT COUNT(*) as c FROM fts.messages_fts").get() as {
				c: number;
			}
		).c;
		const channels = this.database
			.prepare(
				"SELECT network, channel, COUNT(*) as c FROM messages GROUP BY network, channel ORDER BY c DESC"
			)
			.all() as {network: string; channel: string; c: number}[];

		return {
			mainPath,
			mainBytes: sizeOf(this.mainPath),
			sidecarPath,
			sidecarBytes: sizeOf(this.sidecarPath),
			messageCount,
			ftsCount,
			channels: channels.map((row) => ({
				network: row.network,
				channel: row.channel,
				messages: row.c,
			})),
		};
	}

	// Write consistent snapshots of both files into dir (created if needed).
	// VACUUM INTO copies a transactionally consistent image without blocking
	// longer than the copy takes, and works while the server keeps running.
	backupTo(dir: string): {main: string; sidecar: string} {
		this.flushBatch();
		mkdirSync(dir, {recursive: true});

		const main = path.join(dir, `${this.userName}.sqlite3`);
		const sidecar = path.join(dir, `${this.userName}.fts.sqlite3`);

		// VACUUM INTO refuses to overwrite, so clear previous backups first.
		for (const target of [main, sidecar]) {
			try {
				unlinkSync(target);
			} catch {
				// Missing file - nothing to clear.
			}
		}

		this.database.exec(`VACUUM INTO '${main.replace(/'/g, "''")}'`);
		this.database.exec(`VACUUM fts INTO '${sidecar.replace(/'/g, "''")}'`);

		return {main, sidecar};
	}

	close() {
		if (!this.isEnabled) {
			return;
		}

		// Flush any pending batched messages. Must not throw: close() runs
		// on shutdown paths that used to be infallible, and a half-closed
		// store (connection left open, isEnabled still true) is worse than
		// losing the unflushed tail to a logged error.
		try {
			this.flushBatch();
		} catch (err) {
			log.error(
				`Failed to flush message batch on close: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}

		// Clear batch timer
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		this.isEnabled = false;

		try {
			this.database.exec("DETACH DATABASE fts");
		} catch (err) {
			// Defensive/explicit only - closing the connection implicitly
			// detaches attached databases anyway.
			log.error(
				`Failed to detach fts sidecar: ${err instanceof Error ? err.message : String(err)}`
			);
		}

		this.database.close();
	}

	fetch_rollbacks(since_version: number): Rollback[] {
		const res = this.database
			.prepare(
				`select version, rollback_forbidden, statement
				from rollback_steps
				join migrations on migrations.id=rollback_steps.migration_id
				where version > ?
				order by version desc, step asc`
			)
			.all(since_version) as {
			version: number;
			rollback_forbidden: number;
			statement: string;
		}[];

		const result: Rollback[] = [];

		// convert to Rollback[]
		// requires ordering in the sql statement
		for (const raw of res) {
			const last = result.at(-1);

			if (!last || raw.version !== last.version) {
				result.push({
					version: raw.version,
					rollback_forbidden: Boolean(raw.rollback_forbidden),
					stmts: [raw.statement],
				});
			} else {
				last.stmts.push(raw.statement);
			}
		}

		return result;
	}

	delete_migrations_older_than(version: number) {
		this.database.prepare("delete from migrations where migrations.version > ?").run(version);
	}

	// returns whether any rollback statements were executed
	_downgrade_to(version: number): boolean {
		const _rollbacks = this.fetch_rollbacks(version);

		if (_rollbacks.length === 0) {
			// Nothing left to roll back (a previous downgrade already
			// dropped everything above the target): still record the
			// target so the version cannot lag behind the schema.
			// Never record upward: that would claim migrations that
			// were never applied.
			if (this.current_version() > version) {
				this.update_version_in_db(version);
			}

			return false;
		}

		const forbidden = _rollbacks.find((item) => item.rollback_forbidden);

		if (forbidden) {
			throw Error(`can't downgrade past ${forbidden.version}`);
		}

		for (const rollback of _rollbacks) {
			for (const stmt of rollback.stmts) {
				this.database.exec(stmt);
			}
		}

		this.delete_migrations_older_than(version);
		this.update_version_in_db(version);

		return true;
	}

	downgrade_to(version: number): number {
		if (version <= 0) {
			throw Error(`${version} is not a valid version to downgrade to`);
		}

		this.database.exec("BEGIN EXCLUSIVE TRANSACTION");

		let rolled_back: boolean;

		try {
			rolled_back = this._downgrade_to(version);
		} catch (err) {
			this.database.exec("ROLLBACK");
			throw err;
		}

		this.database.exec("COMMIT");

		if (rolled_back) {
			this.vacuum();
		}

		return version;
	}

	downgrade() {
		return this.downgrade_to(currentSchemaVersion);
	}

	insert_rollback_since(version: number) {
		const missing = newRollbacks(version);

		for (const rollback of missing) {
			const migration = this.database
				.prepare(
					`insert into migrations
					(version, rollback_forbidden)
					values (?, ?)
					returning id`
				)
				.get(rollback.version, rollback.rollback_forbidden ? 1 : 0) as {id: number};

			let step = 0;

			for (const stmt of rollback.stmts) {
				this.database
					.prepare(
						`insert into rollback_steps
						(migration_id, step, statement)
						values (?, ?, ?)`
					)
					.run(migration.id, step, stmt);
				step++;
			}
		}
	}

	index(network: Network, channel: Chan, msg: Msg) {
		if (!this.isEnabled) {
			return;
		}

		const clonedMsg = Object.keys(msg).reduce((newMsg, prop) => {
			// id is regenerated when messages are retrieved
			// storageId is the rowid, re-attached on every read - never stored
			// previews are not stored because storage is cleared on lounge restart
			// showInActive is only processed on "msg", don't need it on page reload
			// type, time, and msgid are stored in separate columns
			if (
				prop !== "id" &&
				prop !== "storageId" &&
				prop !== "previews" &&
				prop !== "showInActive" &&
				prop !== "type" &&
				prop !== "time" &&
				prop !== "msgid"
			) {
				newMsg[prop] = msg[prop];
			}

			return newMsg;
		}, {});

		// Add to the batch queue instead of inserting immediately;
		// flushBatch() writes the main row and the sidecar FTS row together
		// in one transaction, then stamps source.storageId with the rowid.
		this.batchQueue.push({
			network: network.uuid,
			channel: channel.name.toLowerCase(),
			time: msg.time.getTime(),
			type: msg.type,
			msg: JSON.stringify(clonedMsg),
			msgid: msg.msgid ?? null,
			text: typeof msg.text === "string" ? msg.text : null,
			source: msg,
		});

		// Flush batch if it reaches the size limit, otherwise flush on timeout
		if (this.batchQueue.length >= this.batchSize) {
			this.flushBatch();
		} else {
			this.scheduleBatchFlush();
		}
	}

	deleteChannel(network: Network, channel: Channel) {
		if (!this.isEnabled) {
			return;
		}

		// Flush any pending batched writes before deleting
		this.flushBatch();

		// No trigger cascades the sidecar delete, so delete from the sidecar
		// explicitly. One transaction across both files - genuinely atomic
		// since neither is in WAL mode (see run_pragmas).
		this.database.exec("BEGIN");

		try {
			this.database
				.prepare(
					"DELETE FROM fts.messages_fts WHERE rowid IN (SELECT id FROM messages WHERE network = ? AND channel = ?)"
				)
				.run(network.uuid, channel.name.toLowerCase());
			this.database
				.prepare("DELETE FROM messages WHERE network = ? AND channel = ?")
				.run(network.uuid, channel.name.toLowerCase());
		} catch (e) {
			this.database.exec("ROLLBACK");
			throw e;
		}

		this.database.exec("COMMIT");
	}

	getMessages(
		network: Network,
		channel: Channel,
		nextID: () => number,
		beforeTime?: number
	): Message[] {
		if (!this.isEnabled || Config.values.maxHistory === 0) {
			return [];
		}

		// Flush any pending batched writes before reading
		this.flushBatch();

		// If unlimited history is specified, load 100k messages
		const limit = Config.values.maxHistory < 0 ? 100000 : Config.values.maxHistory;

		// beforeTime (inclusive) bounds the load to rows older than what the
		// caller already holds, so a late first load can't duplicate live
		// messages that arrived - and were indexed - while history was still
		// unloaded. Callers dedupe the inclusive boundary by content.
		let query = getMessagesQuery;
		const args: (string | number)[] = [network.uuid, channel.name.toLowerCase(), limit];

		if (beforeTime !== undefined) {
			query =
				"SELECT id, msg, type, time, msgid FROM messages WHERE network = ? AND channel = ? AND time <= ? ORDER BY time DESC, id DESC LIMIT ?";
			args.splice(2, 0, beforeTime);
		}

		const rows = this.timedAll("getMessages", query, ...args) as StoredRow[];

		return rows.reverse().map((row) => parseStoredRow(row, nextID));
	}

	search(query: SearchQuery): SearchResponse {
		if (!this.isEnabled) {
			// this should never be hit as messageProvider is checked in client.search()
			throw new Error(
				"search called but sqlite provider not enabled. This is a programming error"
			);
		}

		// Flush any pending batched writes before searching
		this.flushBatch();

		const searchTermParts = query.searchTerm.split(" ");

		let userFilter: string | null = null;
		let dateEndFilter: number | null = null;
		let dateStartFilter: number | null = null;

		for (const part of [...searchTermParts]) {
			if (part.startsWith("from:") && userFilter === null) {
				userFilter = part.slice(5);
				searchTermParts.splice(searchTermParts.indexOf(part), 1);
			}

			if (part.startsWith("datebefore:") && dateEndFilter === null) {
				const date = new Date(part.slice(11));

				if (!Number.isNaN(date.getTime())) {
					dateEndFilter = date.getTime();
					searchTermParts.splice(searchTermParts.indexOf(part), 1);
				}
			}

			if (part.startsWith("dateafter:") && dateStartFilter === null) {
				const date = new Date(part.slice(10));

				if (!Number.isNaN(date.getTime())) {
					dateStartFilter = date.getTime();
					searchTermParts.splice(searchTermParts.indexOf(part), 1);
				}
			}
		}

		// Using the '@' character to escape '%' and '_' in patterns.
		const escapedSearchTerm = searchTermParts.join(" ").replace(/([%_@])/g, "@$1");

		// Two-tier search. The LIKE below is the arbiter of what matches, so
		// result sets stay byte-identical to the old unindexed query
		// (substring semantics, '@'-escaping, case-insensitivity).
		// The MATCH prefilter only narrows candidates through the trigram
		// index first: every LIKE hit necessarily contains each long
		// alphanumeric run of the term, and each such run is present in the
		// trigram index (same case folding on both sides), so the prefilter
		// can only discard rows LIKE would reject anyway. It is skipped
		// entirely when the term has no usable run (short/punctuation-only
		// terms), which then behave exactly like the old full scan.
		// Runs must be at least 3 chars: shorter tokens cannot use the
		// trigram index and silently destroy recall. Each run is
		// double-quoted so FTS5 keywords (AND/OR/NOT/NEAR) in the term stay
		// literals instead of becoming operators.
		const matchTokens = uniqueMatchTokens(searchTermParts.join(" "));

		// NOTE: FTS5 MATCH does not accept a table alias or a qualified
		// name here - it must be the bare table name `messages_fts`.
		let select =
			"SELECT m.id, m.msg, m.type, m.time, m.network, m.channel, m.msgid FROM messages AS m WHERE m.type = 'message' AND json_extract(m.msg, '$.text') LIKE ? ESCAPE '@'";
		const params: (string | number)[] = [`%${escapedSearchTerm}%`];

		if (matchTokens.length > 0) {
			select +=
				" AND m.id IN (SELECT rowid FROM fts.messages_fts WHERE messages_fts MATCH ?)";
			params.push(matchTokens.map((token) => `"${token}"`).join(" AND "));
		}

		if (query.networkUuid) {
			select += " AND m.network = ? ";
			params.push(query.networkUuid);
		}

		if (query.channelName) {
			select += " AND m.channel = ? ";
			params.push(query.channelName.toLowerCase());
		}

		if (userFilter !== null) {
			select += " AND LOWER(json_extract(m.msg, '$.from.nick')) = ? ";
			params.push(userFilter.toLowerCase());
		}

		if (dateEndFilter !== null) {
			select += " AND m.time <= ? ";
			params.push(dateEndFilter);
		}

		if (dateStartFilter !== null) {
			select += " AND m.time >= ? ";
			params.push(dateStartFilter);
		}

		const maxResults = 100;

		select += " ORDER BY m.time DESC, m.id DESC LIMIT ? OFFSET ? ";
		params.push(maxResults);
		params.push(query.offset);

		const rows = this.timedAll("search", select, ...params) as StoredRow[];
		let id = query.offset;

		return {
			...query,
			results: rows.map((row) => parseStoredRow(row, () => id++)).reverse(),
		};
	}

	// Get a window of messages around a stored row id (for jumping to a
	// search result, mention, or notification). Anchoring on the stable
	// rowid - not a timestamp - makes the window exact even when many
	// messages share a millisecond. Returns the window newest-last plus
	// whether history exists on either side of it.
	getMessagesAround(
		network: Network,
		channel: Channel,
		storageId: number,
		beforeCount: number,
		afterCount: number,
		nextID: () => number
	): MessageWindow | null {
		if (!this.isEnabled) {
			return null;
		}

		// Flush any pending batched writes before reading (a jump target may
		// itself still sit in the queue with no rowid assigned yet - in
		// which case it simply isn't found and the caller falls back).
		this.flushBatch();

		const target = this.getStoredMessage(network, channel, storageId);

		if (!target) {
			return null;
		}

		// Load one extra message on each side to check if more history is available
		const before = beforeCount
			? this.getRowsBefore(network, channel, target, beforeCount + 1)
			: [];
		const after = afterCount ? this.getRowsAfter(network, channel, target, afterCount + 1) : [];

		return {
			messages: before
				.slice(0, beforeCount)
				.reverse()
				.concat(target, after.slice(0, afterCount))
				.map((row) => parseStoredRow(row, nextID)),
			hasMoreBefore: before.length > beforeCount,
			hasMoreAfter: after.length > afterCount,
		};
	}

	private getStoredMessage(network: Network, channel: Channel, storageId: number) {
		return this.database
			.prepare(
				"SELECT id, msg, type, time, msgid FROM messages WHERE id = ? AND network = ? AND channel = ?"
			)
			.get(storageId, network.uuid, channel.name.toLowerCase()) as StoredRow | undefined;
	}

	private getRowsBefore(network: Network, channel: Channel, target: StoredRow, limit: number) {
		return this.timedAll(
			"getRowsBefore",
			`SELECT id, msg, type, time, msgid FROM messages
			 WHERE network = ? AND channel = ?
			 AND (time < ? OR (time = ? AND id < ?))
			 ORDER BY time DESC, id DESC LIMIT ?`,
			network.uuid,
			channel.name.toLowerCase(),
			target.time,
			target.time,
			target.id,
			limit
		) as StoredRow[];
	}

	private getRowsAfter(network: Network, channel: Channel, target: StoredRow, limit: number) {
		return this.timedAll(
			"getRowsAfter",
			`SELECT id, msg, type, time, msgid FROM messages
			 WHERE network = ? AND channel = ?
			 AND (time > ? OR (time = ? AND id > ?))
			 ORDER BY time ASC, id ASC LIMIT ?`,
			network.uuid,
			channel.name.toLowerCase(),
			target.time,
			target.time,
			target.id,
			limit
		) as StoredRow[];
	}

	deleteMessages(req: DeletionRequest): number {
		// Flush any pending batched writes before deleting
		this.flushBatch();

		// Select victims in chunks and delete chunk by chunk: materializing
		// every id at once would hold millions of numbers for an unlimited
		// (`limit: -1`) cleanup, and a single statement can neither exceed
		// the JS argument limit nor SQLite's variable-number limit. The
		// explicit id ASC secondary sort keeps victims deterministic across
		// chunks (no trigger cascades the sidecar delete, so both files are
		// driven from the same materialized id list).
		let sql = "select id from messages where\n";
		// We roughly get a timestamp from N days before.
		// We don't adjust for daylight savings time or other weird time jumps
		const millisecondsInDay = 24 * 60 * 60 * 1000;
		const deleteBefore = Date.now() - req.olderThanDays * millisecondsInDay;
		sql += "time <= ?\n";
		const params: (string | number)[] = [deleteBefore];

		if (req.messageTypes !== null) {
			const placeholder = new Array(req.messageTypes.length).fill("?").join(",");
			sql += `and type in (${placeholder})\n`;
			params.push(...req.messageTypes);
		}

		sql += "order by time asc, id asc\n";
		sql += "limit ?\n";
		params.push(deleteIdChunkSize);

		let deleted = 0;

		for (;;) {
			// Honor a finite limit exactly: the last chunk takes only what
			// remains (a negative limit means unlimited, per the cleaner's
			// -1 convention).
			const remaining = req.limit < 0 ? deleteIdChunkSize : req.limit - deleted;

			if (remaining <= 0) {
				break;
			}

			params[params.length - 1] = Math.min(remaining, deleteIdChunkSize);

			const idRows = this.timedAll("deleteMessages", sql, ...params) as {id: number}[];
			const ids = idRows.map((row) => row.id);

			if (ids.length === 0) {
				break;
			}

			const placeholders = ids.map(() => "?").join(",");

			// One transaction across both files - genuinely atomic since
			// neither is in WAL mode (see run_pragmas).
			this.database.exec("BEGIN");

			try {
				this.database
					.prepare(`DELETE FROM fts.messages_fts WHERE rowid IN (${placeholders})`)
					.run(...ids);
				this.database
					.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`)
					.run(...ids);
			} catch (e) {
				this.database.exec("ROLLBACK");
				throw e;
			}

			this.database.exec("COMMIT");

			deleted += ids.length;
		}

		return deleted;
	}

	canProvideMessages() {
		return this.isEnabled;
	}
}

// Extract the MATCH-prefilter tokens for a search term: unique ASCII
// alphanumeric runs of at least 3 characters. Shorter runs cannot use the
// trigram index (and would silently destroy recall if passed to MATCH);
// non-ASCII runs are left out so the prefilter never disagrees with LIKE's
// byte-wise substring semantics - those terms simply skip the prefilter.
function uniqueMatchTokens(term: string): string[] {
	const tokens = term.match(/[A-Za-z0-9]{3,}/g) ?? [];
	return [...new Set(tokens)];
}

/**
 * Maps one stored row to a Message, re-attaching its stable row id so the
 * result can later be jumped to by storageId. Session ids still come from
 * nextID (rowids collide with live session ids, which both start at 1).
 *
 * Throws on corrupt rows: callers (getMessages/search/getMessagesAround)
 * intentionally let this propagate so a corrupt row surfaces instead of
 * silently returning partial history.
 *
 * @param row Raw storage row.
 * @param nextID Allocator for session message ids.
 * @returns Parsed message with storageId attached.
 */
function parseStoredRow(row: StoredRow, nextID: () => number): Message {
	let msg: any;

	try {
		msg = JSON.parse(row.msg);
	} catch (e) {
		log.error(`Failed to parse stored message id=${row.id}: ${String(e)}`);
		throw e instanceof Error ? e : new Error(String(e));
	}

	if (typeof msg !== "object" || msg === null) {
		throw new Error(`Corrupt stored message id=${row.id}: expected an object`);
	}

	msg.time = row.time;
	msg.type = row.type;

	if (row.network !== undefined) {
		msg.networkUuid = row.network;
	}

	if (row.channel !== undefined) {
		msg.channelName = row.channel;
	}

	if (row.msgid) {
		msg.msgid = row.msgid;
	}

	const newMsg = new Msg(msg);
	newMsg.id = nextID();
	newMsg.storageId = row.id;

	return newMsg;
}

/**
 * Returns pending main-schema migrations newer than `since`.
 *
 * Pure and total: never throws for any numeric input.
 *
 * @param since Applied schema version.
 * @returns Migrations that still need to run.
 */
export function necessaryMigrations(since: number): Migration[] {
	return migrations.filter((m) => m.version > since);
}

/**
 * Returns rollback records for migrations newer than `since`.
 *
 * Pure and total: never throws for any numeric input.
 *
 * @param since Applied schema version.
 * @returns Rollback entries recorded after `since`.
 */
export function newRollbacks(since: number): Rollback[] {
	return rollbacks.filter((r) => r.version > since);
}

export default SqliteMessageStorage;
