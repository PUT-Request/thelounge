import * as path from "path";
const home = path.join(process.cwd(), "test", "fixtures", ".thelounge");

import config from "../../server/config";
config.setHome(home);

// client/js/socket.ts reads this at import time; component tests running
// under jsdom need it set before the import chain executes.
if (typeof document !== "undefined" && document.body && !document.body.dataset.transports) {
	document.body.dataset.transports = '["websocket"]';
}
