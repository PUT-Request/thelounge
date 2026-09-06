import {nextTick} from "vue";

import socket from "../socket";
import {store} from "../store";
import {extractInputHistory} from "../helpers/inputHistory";
import {markMsgsRaw, unshiftMany} from "../chan";

socket.on("more", async (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	channel.inputHistory = channel.inputHistory.concat(
		extractInputHistory(data.messages, 100 - channel.inputHistory.length)
	);
	channel.moreHistoryAvailable =
		data.moreHistoryAvailable ??
		(data.totalMessages !== undefined &&
			data.totalMessages > channel.messages.length + data.messages.length);

	// Drop page messages already present: rows fetched from the database get
	// fresh session ids on every request, but carry the stable storage id
	// of their row, so identity comparison works again (unlike timestamps).
	const known = new Set(channel.messages.map((m) => messageKey(m)));
	const fresh = markMsgsRaw(data.messages).filter((m) => !known.has(messageKey(m)));

	// Chunked prepend: a single spread call blows the call stack on large
	// history batches (see unshiftMany). Mirror the server's scrollback cap
	// so both sides evict the same oldest messages and anchors stay valid.
	unshiftMany(channel.messages, fresh);

	const batchSize = store.state.settings.statusMessages !== "shown" ? 1000 : 100;
	const maxBuffered = 3 * batchSize;

	if (channel.messages.length > maxBuffered) {
		// This is a backwards page: preserve the newly prepended oldest rows and
		// evict from the newest end. Forward paging performs the opposite trim.
		channel.messages.splice(maxBuffered);
	}

	await nextTick();
	channel.historyLoading = false;
});

// Stable identity for dedupe: the storage row id when known, otherwise the
// session id (unique within a session for anything never reloaded).
function messageKey(m: {id: number; storageId?: number}): string {
	return m.storageId !== undefined && m.storageId !== null ? `s${m.storageId}` : `m${m.id}`;
}
