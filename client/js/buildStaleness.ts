import {ref} from "vue";

// Build hash baked in at compile time (see vite.config.ts `define`). Polled
// against the server's /version-hash endpoint: a mismatch means this tab is
// running a stale client build from before a server rebuild/redeploy.
declare const __BUILD_HASH__: string;

const buildHash = typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";

const isStale = ref(false);

async function checkStaleness() {
	if (isStale.value) {
		return;
	}

	let response: Response | null;

	try {
		response = await fetch("version-hash", {cache: "no-store"});
	} catch {
		// Server unreachable - not a stale build, just offline. Try again
		// at the next interval.
		return;
	}

	if (!response.ok) {
		return;
	}

	const serverHash = (await response.text()).trim();

	if (serverHash && serverHash !== buildHash) {
		isStale.value = true;
	}
}

let started = false;

export function startStalenessChecks() {
	if (started) {
		return;
	}

	started = true;

	// Once on load plus every 10 minutes after that
	void checkStaleness();
	window.setInterval(() => void checkStaleness(), 10 * 60 * 1000);
}

export {isStale};
