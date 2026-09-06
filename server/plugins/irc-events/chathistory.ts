import type {IrcEventHandler} from "../../client";
import type Client from "../../client";
import type Network from "../../models/network";
import Chan, {historyDedupeKey} from "../../models/chan";
import type Msg from "../../models/msg";
import Config from "../../config";
import log from "../../log";
import {ChanState, ChanType} from "../../../shared/types/chan";

// How many messages to pull from server-side history per request.
const FETCH_LIMIT = 100;

// LATEST responses extend the live tail, but backward pages belong to a
// browser's history window and must not replace the server's current tail.
const MAX_LIVE_BUFFERED = 300;

// Give up on a fetch that never completes (no batch end, no FAIL).
const FETCH_TIMEOUT_MS = 60000;

type HistoryFetch = {
	client: Client;
	network: Network;
	target: string;
	kind: "before" | "latest";
	batchId?: string;
	collected: Msg[];
	timer: ReturnType<typeof setTimeout>;
};

const pendingFetches = new Map<string, HistoryFetch>();
const fetchesByBatch = new Map<string, string>();
const beforeCursors = new Map<string, string>();

export function isChathistoryAvailable(irc: unknown): boolean {
	// NOTE: call isEnabled as a method. It reads `this.enabled`
	// internally, so a detached reference throws.
	const cap = (irc as {network?: {cap?: {isEnabled?: (cap: string) => boolean}}})?.network?.cap;

	if (!cap || typeof cap.isEnabled !== "function") {
		return false;
	}

	return cap.isEnabled("draft/chathistory");
}

function fetchKey(network: Network, target: string): string {
	return `${network.uuid}/${network.casefold(target)}`;
}

// Called by the message handler for chathistory playback members. Returns
// true when the message was diverted into a pending BEFORE fetch (caller
// must skip normal delivery), false otherwise.
export function collectPlaybackMessage(
	network: Network,
	chan: Chan,
	msg: Msg,
	batchId?: string
): boolean {
	if (!batchId) {
		return false;
	}

	const key = fetchesByBatch.get(batchId);
	const pending = key ? pendingFetches.get(key) : undefined;

	if (
		!pending ||
		pending.network !== network ||
		network.casefold(pending.target) !== network.casefold(chan.name)
	) {
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

		if (pending.batchId) {
			fetchesByBatch.delete(pending.batchId);
		}

		pendingFetches.delete(key);
	}
}

export function cleanupHistoryFetches(network: Network): void {
	for (const [key, pending] of pendingFetches) {
		if (pending.network === network) {
			dropFetch(key);
		}
	}

	for (const key of beforeCursors.keys()) {
		if (key.startsWith(`${network.uuid}/`)) {
			beforeCursors.delete(key);
		}
	}
}

function getFetchLimit(irc: NonNullable<Network["irc"]>): number {
	const advertised = Number(irc.network.supports("CHATHISTORY"));
	return Number.isSafeInteger(advertised) && advertised > 0
		? Math.min(FETCH_LIMIT, advertised)
		: FETCH_LIMIT;
}

function getReferenceTypes(irc: NonNullable<Network["irc"]>): string[] {
	const advertised = (
		irc.network as unknown as {supports: (feature: string) => unknown}
	).supports("MSGREFTYPES");
	return typeof advertised === "string" ? advertised.split(",") : ["msgid", "timestamp"];
}

function getHistoryReference(
	irc: NonNullable<Network["irc"]>,
	message: Msg | undefined
): string | null {
	if (!message) {
		return null;
	}

	for (const type of getReferenceTypes(irc)) {
		if (type === "msgid" && message.msgid) {
			return `msgid=${message.msgid}`;
		}

		if (type === "timestamp") {
			return `timestamp=${message.time.toISOString()}`;
		}
	}

	return null;
}

function createFetch(
	client: Client,
	network: Network,
	chan: Chan,
	kind: HistoryFetch["kind"]
): boolean {
	const key = fetchKey(network, chan.name);

	if (pendingFetches.has(key)) {
		return false;
	}

	const timer = setTimeout(() => {
		const pending = pendingFetches.get(key);

		if (!pending) {
			return;
		}

		log.warn(`Timed out waiting for CHATHISTORY ${pending.kind} batch for ${pending.target}`);
		deliverFetch(key);
	}, FETCH_TIMEOUT_MS);

	if (typeof timer.unref === "function") {
		timer.unref();
	}

	pendingFetches.set(key, {client, network, target: chan.name, kind, collected: [], timer});
	return true;
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

	const cursor = beforeCursors.get(fetchKey(network, chan.name));
	const oldestMessage = chan.messages.reduce<Msg | undefined>(
		(oldest, message) =>
			!oldest || message.time.getTime() < oldest.time.getTime() ? message : oldest,
		undefined
	);
	const reference =
		cursor ??
		getHistoryReference(irc, oldestMessage) ??
		(getReferenceTypes(irc).includes("timestamp")
			? `timestamp=${new Date().toISOString()}`
			: null);

	if (!reference) {
		return false;
	}

	if (!createFetch(client, network, chan, "before")) {
		return false;
	}

	irc.raw("CHATHISTORY", "BEFORE", chan.name, reference, String(getFetchLimit(irc)));
	return true;
}

function deliverFetch(key: string): void {
	const pending = pendingFetches.get(key);

	if (!pending) {
		return;
	}

	pendingFetches.delete(key);
	clearTimeout(pending.timer);

	if (pending.batchId) {
		fetchesByBatch.delete(pending.batchId);
	}

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

	if (pending.kind === "before") {
		if (collected.length > 0) {
			const earliest = collected.reduce((oldest, message) =>
				message.time.getTime() < oldest.time.getTime() ? message : oldest
			);
			const cursor = network.irc ? getHistoryReference(network.irc, earliest) : null;

			if (cursor) {
				beforeCursors.set(key, cursor);
			}
		}

		client.emit("more", {
			chan: chan.id,
			messages: fresh,
			moreHistoryAvailable: collected.length > 0,
		});
	} else {
		chan.messages.push(...fresh);

		if (chan.messages.length > MAX_LIVE_BUFFERED) {
			const evicted = chan.messages.splice(0, chan.messages.length - MAX_LIVE_BUFFERED);
			chan.dereferencePreviews(evicted);
		}

		client.emit("history:newer", {
			chan: chan.id,
			messages: fresh,
			hasMoreAfter: false,
		});
	}
}

export default <IrcEventHandler>function (irc, network) {
	const client = this;
	let targetsRequested = false;
	const targetBatches = new Map<string, Set<string>>();

	function syncCapabilityState() {
		const supported = isChathistoryAvailable(irc);

		if (network.serverOptions.supportsChathistory !== supported) {
			network.serverOptions.supportsChathistory = supported;
			client.emit("network:options", {
				network: network.uuid,
				serverOptions: network.serverOptions,
			});
		}
	}

	function maybeFetchHistory(chan: Chan) {
		if (
			(chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) ||
			(chan.type === ChanType.CHANNEL && chan.state !== ChanState.JOINED)
		) {
			return;
		}

		if (!isChathistoryAvailable(irc)) {
			return;
		}

		if (!createFetch(client, network, chan, "latest")) {
			return;
		}

		const newest = chan.messages.reduce<Msg | undefined>(
			(latest, message) =>
				message.time instanceof Date &&
				(!latest || message.time.getTime() > latest.time.getTime())
					? message
					: latest,
			undefined
		);
		const reference = getHistoryReference(irc, newest) ?? "*";

		network.irc.raw(
			"CHATHISTORY",
			"LATEST",
			chan.name,
			reference,
			String(getFetchLimit(network.irc))
		);
	}

	function requestTargets() {
		if (targetsRequested || !isChathistoryAvailable(irc)) {
			return;
		}

		const latestKnown = network.channels
			.filter((chan) => chan.type === ChanType.CHANNEL || chan.type === ChanType.QUERY)
			.flatMap((chan) => chan.messages)
			.reduce((latest, message) => Math.max(latest, message.time?.getTime() ?? 0), 0);
		const upper = new Date(Date.now() + 10000).toISOString();
		const lower = new Date(Math.max(0, latestKnown - 10000)).toISOString();

		targetsRequested = true;
		irc.raw(
			"CHATHISTORY",
			"TARGETS",
			`timestamp=${upper}`,
			`timestamp=${lower}`,
			String(getFetchLimit(irc))
		);
	}

	// Our own joins: the channel object is fresh, so history is missing.
	irc.on("join", function (data) {
		if (network.casefold(data.nick) !== network.casefold(irc.user.nick)) {
			return;
		}

		const chan = network.getChannel(data.channel);

		if (typeof chan === "undefined") {
			return;
		}

		if (chan.type === ChanType.CHANNEL) {
			maybeFetchHistory(chan);
		}
	});

	// A capability can also appear mid-session via CAP NEW (the framework
	// auto-requests it); backfill channels that joined without history.
	irc.on("cap ack", function (data) {
		syncCapabilityState();
		const caps = data.capabilities || {};

		if (!("draft/chathistory" in caps)) {
			return;
		}

		for (const chan of network.channels) {
			maybeFetchHistory(chan);
		}

		requestTargets();
	});

	irc.on("registered", requestTargets);

	irc.on("socket close", function () {
		targetsRequested = false;
		targetBatches.clear();
	});

	irc.on("cap del", function () {
		syncCapabilityState();
		cleanupHistoryFetches(network);
	});

	// Correlate a batch with the request for its target. Both manual BEFORE
	// and automatic LATEST messages are held until the matching batch ends.
	irc.on("batch start chathistory", function (data) {
		const params = Array.isArray(data.params) ? data.params : [];
		const target = typeof params[0] === "string" ? params[0] : undefined;
		const batchId = typeof data.id === "string" ? data.id : undefined;

		if (!target || !batchId) {
			return;
		}

		const key = fetchKey(network, target);
		const pending = pendingFetches.get(key);

		if (pending && !pending.batchId) {
			pending.batchId = batchId;
			fetchesByBatch.set(batchId, key);
		}
	});

	irc.on("batch end chathistory", function (data) {
		const batchId = typeof data.id === "string" ? data.id : undefined;
		const key = batchId ? fetchesByBatch.get(batchId) : undefined;

		if (key) {
			deliverFetch(key);
		}
	});

	irc.on("batch start draft/chathistory-targets", function (data) {
		if (typeof data.id === "string") {
			targetBatches.set(data.id, new Set());
		}
	});

	irc.on("unknown command", function (command) {
		if (
			command.command !== "CHATHISTORY" ||
			command.batch?.type !== "draft/chathistory-targets" ||
			typeof command.batch.id !== "string" ||
			command.params?.[0] !== "TARGETS" ||
			typeof command.params[1] !== "string"
		) {
			return;
		}

		targetBatches.get(command.batch.id)?.add(command.params[1]);
	});

	irc.on("batch end draft/chathistory-targets", function (data) {
		const targets = typeof data.id === "string" ? targetBatches.get(data.id) : undefined;

		if (!targets) {
			return;
		}

		targetBatches.delete(data.id);

		for (const target of targets) {
			// Joined channel history is handled independently. TARGETS is needed
			// here to discover direct-message buffers that do not yet exist.
			if (
				(
					irc.network as unknown as {isChannelName: (name: string) => boolean}
				).isChannelName(target)
			) {
				continue;
			}

			let chan = network.getChannel(target);

			if (!chan) {
				chan = client.createChannel({type: ChanType.QUERY, name: target});
				client.emit("join", {
					network: network.uuid,
					chan: chan.getFilteredClone(true),
					shouldOpen: false,
					index: network.addChannel(chan),
				});
				client.save();
				chan.loadMessages(client, network);
			}

			maybeFetchHistory(chan);
		}
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
