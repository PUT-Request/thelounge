import {workerData} from "worker_threads";
import SqliteMessageStorage from "../plugins/messageStorage/sqlite";

const data = workerData as {databasePath: string; userName: string};
const storage = new SqliteMessageStorage(data.userName);

storage._enable(data.databasePath);
storage.close();
