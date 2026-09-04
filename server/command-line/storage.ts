import log from "../log";
import {Command} from "commander";
import ClientManager from "../clientManager";
import Utils from "./utils";
import SqliteMessageStorage from "../plugins/messageStorage/sqlite";
import {StorageCleaner} from "../storageCleaner";

const program = new Command("storage").description(
	"various utilities related to the message storage"
);

program
	.command("migrate")
	.argument("[username]", "migrate a specific user only, all if not provided")
	.description("Migrate message storage where needed")
	.on("--help", Utils.extraHelp)
	.action(function (user) {
		try {
			runMigrations(user);
		} catch (err: any) {
			log.error(err.toString());
			process.exit(1);
		}
	});

program
	.command("clean")
	.argument("[user]", "clean messages for a specific user only, all if not provided")
	.description("Delete messages from the DB based on the storage policy")
	.on("--help", Utils.extraHelp)
	.action(function (user) {
		try {
			runCleaning(user);
		} catch (err: any) {
			log.error(err.toString());
			process.exit(1);
		}
	});

program
	.command("stats")
	.argument("[user]", "show storage stats for a specific user only, all if not provided")
	.description("Show message counts, database sizes, and per-channel breakdown")
	.on("--help", Utils.extraHelp)
	.action(function (user) {
		try {
			runStats(user);
		} catch (err: any) {
			log.error(err.toString());
			process.exit(1);
		}
	});

program
	.command("backup")
	.argument("<destination>", "directory to write the backup files into")
	.argument("[user]", "back up a specific user only, all if not provided")
	.description("Write consistent snapshots of message databases (main + search index)")
	.on("--help", Utils.extraHelp)
	.action(function (destination, user) {
		try {
			runBackup(destination, user);
		} catch (err: any) {
			log.error(err.toString());
			process.exit(1);
		}
	});

function runMigrations(user?: string) {
	const manager = new ClientManager();
	const users = manager.getUsers();

	if (user) {
		if (!users.includes(user)) {
			throw new Error(`invalid user ${user}`);
		}

		return migrateUser(manager, user);
	}

	for (const name of users) {
		migrateUser(manager, name);
		// if any migration fails we blow up,
		// chances are the rest won't complete either
	}
}

// runs sqlite migrations for a user, which must exist
function migrateUser(manager: ClientManager, user: string) {
	log.info("handling user", user);

	if (!isUserLogEnabled(manager, user)) {
		log.info("logging disabled for user", user, ". Skipping");
		return;
	}

	const sqlite = new SqliteMessageStorage(user);
	sqlite.enable();
	sqlite.close();
	log.info("user", user, "migrated successfully");
}

function isUserLogEnabled(manager: ClientManager, user: string): boolean {
	const conf = manager.readUserConfig(user);

	if (!conf) {
		log.error("Could not open user configuration of", user);
		return false;
	}

	return conf.log;
}

function runCleaning(user: string) {
	const manager = new ClientManager();
	const users = manager.getUsers();

	if (user) {
		if (!users.includes(user)) {
			throw new Error(`invalid user ${user}`);
		}

		return cleanUser(manager, user);
	}

	for (const name of users) {
		cleanUser(manager, name);
		// if any migration fails we blow up,
		// chances are the rest won't complete either
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}

	return `${value.toFixed(1)} ${units[unit]}`;
}

function runStats(user?: string) {
	const manager = new ClientManager();
	const users = user ? [user] : manager.getUsers();

	if (user && !manager.getUsers().includes(user)) {
		throw new Error(`invalid user ${user}`);
	}

	for (const name of users) {
		statsUser(manager, name);
	}
}

function statsUser(manager: ClientManager, user: string) {
	log.info(`handling user ${user}`);

	if (!isUserLogEnabled(manager, user)) {
		log.info(`logging disabled for user ${user}. Skipping`);
		return;
	}

	const sqlite = new SqliteMessageStorage(user);
	sqlite.enable();

	try {
		const stats = sqlite.getStats();
		log.info(`  main database: ${stats.mainPath} (${formatBytes(stats.mainBytes)})`);
		log.info(`  search index:  ${stats.sidecarPath} (${formatBytes(stats.sidecarBytes)})`);
		log.info(`  messages: ${stats.messageCount} stored, ${stats.ftsCount} indexed`);

		for (const channel of stats.channels.slice(0, 20)) {
			log.info(`    ${channel.network} / ${channel.channel}: ${channel.messages} messages`);
		}

		if (stats.channels.length > 20) {
			log.info(`    ... and ${stats.channels.length - 20} more channels`);
		}
	} finally {
		sqlite.close();
	}
}

function runBackup(destination: string, user?: string) {
	const manager = new ClientManager();
	const users = user ? [user] : manager.getUsers();

	if (user && !manager.getUsers().includes(user)) {
		throw new Error(`invalid user ${user}`);
	}

	for (const name of users) {
		backupUser(manager, name, destination);
	}
}

function backupUser(manager: ClientManager, user: string, destination: string) {
	log.info(`handling user ${user}`);

	if (!isUserLogEnabled(manager, user)) {
		log.info(`logging disabled for user ${user}. Skipping`);
		return;
	}

	const sqlite = new SqliteMessageStorage(user);
	sqlite.enable();

	try {
		const {main, sidecar} = sqlite.backupTo(destination);
		log.info(`backed up ${user} to ${main} and ${sidecar}`);
	} finally {
		sqlite.close();
	}
}

function cleanUser(manager: ClientManager, user: string) {
	log.info("handling user", user);

	if (!isUserLogEnabled(manager, user)) {
		log.info("logging disabled for user", user, ". Skipping");
		return;
	}

	const sqlite = new SqliteMessageStorage(user);
	sqlite.enable();
	const cleaner = new StorageCleaner(sqlite);
	const num_deleted = cleaner.runDeletesNoLimit();
	log.info(`deleted ${num_deleted} messages`);
	log.info("running a vacuum now, this might take a while");

	if (num_deleted > 0) {
		sqlite.vacuum();
	}

	sqlite.close();
	log.info(`cleaning messages for ${user} has been successful`);
}

export default program;
