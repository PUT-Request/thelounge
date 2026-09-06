import {DatabaseSync} from "node:sqlite";
import {parentPort, workerData} from "node:worker_threads";

import SqliteMessageStorage from "../plugins/messageStorage/sqlite";
import {SearchQuery, SearchResponse} from "../../shared/types/storage";

type SearchWorkerData = {
	mainPath: string;
	sidecarPath: string;
	query: SearchQuery;
};

const data = workerData as SearchWorkerData;
const storage = new SqliteMessageStorage("search-worker");

try {
	// The primary process owns migrations, reconciliation, and writes. This
	// connection is deliberately read-only and exists for one bounded query.
	storage.database = new DatabaseSync(data.mainPath, {readOnly: true});
	storage.database.prepare("ATTACH DATABASE ? AS fts").run(data.sidecarPath);
	storage.mainPath = data.mainPath;
	storage.sidecarPath = data.sidecarPath;
	storage.isEnabled = true;

	const result: SearchResponse = storage.search(data.query);
	parentPort?.postMessage({result});
} catch (error: unknown) {
	parentPort?.postMessage({error: error instanceof Error ? error.message : String(error)});
} finally {
	storage.close();
}
