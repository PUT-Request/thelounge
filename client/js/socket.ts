import io, {Socket as rawSocket} from "socket.io-client";
import type {ServerToClientEvents, ClientToServerEvents} from "../../shared/types/socket-events";

type Socket = rawSocket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Parses the socket.io transport list from the server-rendered body dataset.
 *
 * Never throws: a corrupt `data-transports` payload falls back to the default
 * `["polling", "websocket"]` transport list so boot never crashes on bad HTML.
 *
 * @returns Transport names accepted by socket.io-client.
 */
function parseTransports(): string[] {
	const fallback = ["polling", "websocket"];

	try {
		const raw = document.body.dataset.transports || "";

		if (!raw) {
			return fallback;
		}

		const parsed: unknown = JSON.parse(raw);

		if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
			return parsed;
		}
	} catch {
		// Corrupt dataset: fall through to the default transports.
	}

	return fallback;
}

const socket: Socket = io({
	transports: parseTransports(),
	path: window.location.pathname + "socket.io/",
	autoConnect: false,
	reconnection: !document.body.classList.contains("public"),
});

// Ease debugging socket during development
if (import.meta.env.DEV) {
	window.socket = socket;
}

declare global {
	interface Window {
		socket: Socket;
	}
}

export default socket;

/**
 * Message for use when the socket disconnects and will not reconnect
 * (e.g. forced disconnects after auth failures)
 */
export const tryAgainMessage = "Disconnected from the server. Please try again later.";
