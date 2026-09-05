import {ref} from "vue";

// Build hash baked in at compile time (see vite.config.ts `define`). Polled
// against the server's /version-hash endpoint: a mismatch means this tab is
// running a stale client build from before a server rebuild/redeploy.
declare const __BUILD_HASH__: string;

const buildHash = typeof __BUILD_HASH__ !== "undefined" ? __BUILD_HASH__ : "dev";

const isStale = ref(false);

/**
 * Polls the server build hash and flags this tab as stale on mismatch.
 *
 * Never rejects: network failures, aborted requests, non-OK responses, and
 * malformed bodies are treated as "unknown, retry later" so the background
 * poller cannot surface unhandled promise rejections.
 */
async function checkStaleness() {
	if (isStale.value) {
		return;
	}

	let response: Response | null = null;

	try {
		response = await fetch("version-hash", {cache: "no-store"});
	} catch {
		// Server unreachable - not a stale build, just offline. Try again
		// at the next interval.
		return;
	}

	try {
		if (!response || !response.ok) {
			return;
		}

		const serverHash = (await response.text()).trim();

		if (serverHash && serverHash !== buildHash) {
			isStale.value = true;
		}
	} catch {
		// Malformed body: treat as unknown and retry at the next interval.
	}
}

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background staleness poller (idempotent).
 *
 * Guards against double-start so duplicate mount calls cannot create
 * overlapping intervals (a race that would double poll traffic).
 */
export function startStalenessChecks() {
	if (started) {
		return;
	}

	started = true;

	// Once on load plus every 10 minutes after that
	void checkStaleness();

	if (intervalId === null) {
		intervalId = window.setInterval(() => void checkStaleness(), 10 * 60 * 1000);
	}
}

export {isStale};
