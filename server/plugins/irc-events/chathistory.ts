import type {IrcEventHandler} from "../../client";
import Chan from "../../models/chan";
import {ChanState, ChanType} from "../../../shared/types/chan";

// How many messages to pull from server-side history on join.
const FETCH_LIMIT = 100;

// Only fetch when the channel holds less than this; anything more means we
// already have history (memory, sqlite, or a previous fetch) or the user is
// rejoining a live channel, e.g. after a reconnect.
const FETCH_THRESHOLD = 25;

export function isChathistoryAvailable(irc: {
	network?: {cap?: {isEnabled?: (cap: string) => boolean}};
}): boolean {
	const isEnabled = irc.network?.cap?.isEnabled;

	if (typeof isEnabled !== "function") {
		return false;
	}

	// Accept both the ratified name and the pre-ratification draft name,
	// whichever the server advertised and acknowledged.
	return isEnabled("chathistory") || isEnabled("draft/chathistory");
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
};
