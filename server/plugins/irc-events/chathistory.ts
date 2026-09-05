import type {IrcEventHandler} from "../../client";
import type Client from "../../client";
import type Network from "../../models/network";
import Chan, {historyDedupeKey} from "../../models/chan";
import type Msg from "../../models/msg";
import Config from "../../config";
import Helper from "../../helper";
import log from "../../log";
import {ChanState, ChanType} from "../../../shared/types/chan";

// How many messages to pull from server-side history per request.
const FETCH_LIMIT = 100;

// Only auto-fetch on join when the channel holds less than this; anything
// more means we already have history (memory, sqlite, or a previous fetch)
// or the user is rejoining a live channel, e.g. after a reconnect.
const FETCH_THRESHOLD = 25;

// Upper bound for in-memory scrollback grown by backward paging, mirroring
// the sqlite-window path in client.more(). Older rows re-fetch on demand.
const MAX_BUFFERED = 300;

// Give up on a fetch that never completes (no batch end, no FAIL).
const FETCH_TIMEOUT_MS = 60000;

type BeforeFetch = {
	client: Client;
	network: Network;
	target: string;
	collected: Msg[];
	timer: ReturnType<typeof setTimeout>;
};

const pendingFetches = new Map<string, BeforeFetch>();

export function isChathistoryAvailable(irc: unknown): boolean {
	const cap = (irc as {network?: {cap?: {isEnabled?: unknown}}})?.network?.cap;
	const isEnabled = cap?.isEnabled;

	if (typeof isEnabled !== "function") {
		return false;
	}

	const check = isEnabled as (cap: string) => boolean;

	// Accept both the ratified name and the pre-ratification draft name,
	// whichever the server advertised and acknowledged.
	return check("chathistory") || check("draft/chathistory");
}

function fetchKey(network: Network, target: string): string {
	return `${network.uuid}/${target.toLowerCase()}`;
}

// Called by the message handler for chathistory playback members. Returns
// true when the message was diverted into a pending BEFORE fetch (caller
// must skip normal delivery), false otherwise.
export function collectPlaybackMessage(network: Network, chan: Chan, msg: Msg): boolean {
	const pending = pendingFetches.get(fetchKey(network, chan.name));

	if (!pending) {
		return false;
	}

	msg.id = pending.client.idMsg++;
	pending.collected.push(msg);
	return true;
}

function dropFetch(key: string): void {
	const pending = pendingFetches.get(key);

	if (pending) {
		clearTimeout(pending.timer);
		pendingFetches.delete(key);
	}
}

// User-initiated "load older messages": pull history preceding the oldest
// message we hold. Returns true when a request was sent.
export function fetchBeforeHistory(client: Client, network: Network, chan: Chan): boolean {
	if (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) {
		return false;
	}

	if (chan.type === ChanType.CHANNEL && chan.state !== ChanState.JOINED) {
		return false;
	}

	const irc = network.irc;

	if (!irc || !isChathistoryAvailable(irc)) {
		return false;
	}

	const key = fetchKey(network, chan.name);

	if (pendingFetches.has(key)) {
		return false;
	}

	let oldest = Date.now();

	for (const msg of chan.messages) {
		const time = msg.time.getTime();

		if (time < oldest) {
			oldest = time;
		}
	}

	const timer = setTimeout(() => {
		pendingFetches.delete(key);
	}, FETCH_TIMEOUT_MS);

	// Don't let the timer keep the process alive on its own
	if (typeof timer.unref === "function") {
		timer.unref();
	}

	pendingFetches.set(key, {
		client,
		network,
		target: chan.name,
		collected: [],
		timer,
	});

	irc.raw(
		"CHATHISTORY",
		"BEFORE",
		chan.name,
		new Date(oldest).toISOString(),
		String(FETCH_LIMIT)
	);
	return true;
}

function deliverFetch(key: string): void {
	const pending = pendingFetches.get(key);

	if (!pending) {
		return;
	}

	pendingFetches.delete(key);
	clearTimeout(pending.timer);

	const {client, network, target, collected} = pending;
	const chan = network.getChannel(target);

	if (typeof chan === "undefined") {
		return;
	}

	// Drop anything that arrived live (or via another source) while fetching
	const known = new Set(chan.messages.map((m) => historyDedupeKey(m)));
	const fresh = collected
		.filter((m) => !known.has(historyDedupeKey(m)))
		.sort((a, b) => a.time.getTime() - b.time.getTime() || a.id - b.id);

	for (const msg of fresh) {
		if (Config.values.public) {
			break;
		}

		for (const storage of client.messageStorage) {
			try {
				storage.index(network, chan, msg);
			} catch (e: unknown) {
				log.error(e instanceof Error ? e.message : String(e));
			}
		}
	}

	// Force the queued sqlite rows out now so storageIds are stamped before
	// delivery: the client dedupes future history pages by storageId.
	for (const storage of client.messageStorage) {
		const flushable = storage as {flushBatch?: () => void};

		if (typeof flushable.flushBatch === "function") {
			try {
				flushable.flushBatch();
			} catch (e: unknown) {
				log.error(e instanceof Error ? e.message : String(e));
			}
		}
	}

	Helper.unshiftMany(chan.messages, fresh);

	if (chan.messages.length > MAX_BUFFERED) {
		const evicted = chan.messages.splice(0, chan.messages.length - MAX_BUFFERED);
		chan.dereferencePreviews(evicted);
	}

	client.emit("more", {
		chan: chan.id,
		messages: fresh,
		totalMessages: chan.messages.length,
	});
}

export default <IrcEventHandler>function (irc, network) {
	function maybeFetchHistory(chan: Chan) {
		if (chan.type !== ChanType.CHANNEL || chan.state !== ChanState.JOINED) {
			return;
		}

		if (!isChathistoryAvailable(irc)) {
			return;
		}

		if (chan.messages.length >= FETCH_THRESHOLD) {
			return;
		}

		// `*` selects the latest messages. Playback arrives as a `chathistory`
		// BATCH whose members flow through the normal message handler, which
		// knows to treat them as history (no unread, no highlights).
		network.irc.raw("CHATHISTORY", "LATEST", chan.name, "*", String(FETCH_LIMIT));
	}

	// Our own joins: the channel object is fresh, so history is missing.
	irc.on("join", function (data) {
		if (data.nick !== irc.user.nick) {
			return;
		}

		const chan = network.getChannel(data.channel);

		if (typeof chan === "undefined") {
			return;
		}

		maybeFetchHistory(chan);
	});

	// A capability can also appear mid-session via CAP NEW (the framework
	// auto-requests it); backfill channels that joined without history.
	irc.on("cap ack", function (data) {
		const caps = data.capabilities || {};

		if (!("chathistory" in caps) && !("draft/chathistory" in caps)) {
			return;
		}

		for (const chan of network.channels) {
			maybeFetchHistory(chan);
		}
	});

	// End of a chathistory batch: deliver an accumulated BEFORE fetch as a
	// single prepend. LATEST auto-fetches have no collector; their members
	// were already delivered individually by the message handler.
	irc.on("batch end chathistory", function (data) {
		const params = Array.isArray(data.params) ? data.params : [];
		const target = typeof params[0] === "string" ? params[0] : undefined;

		if (!target) {
			return;
		}

		deliverFetch(fetchKey(network, target));
	});

	// A rejected fetch still ends with a standard FAIL; drop its collector
	// so a retry can start clean (the FAIL itself is already routed).
	irc.on("standard reply", function (data) {
		if (data.command !== "CHATHISTORY") {
			return;
		}

		const context = Array.isArray(data.context) ? data.context : [];

		for (const param of context) {
			if (typeof param === "string") {
				dropFetch(fetchKey(network, param));
			}
		}
	});
};
