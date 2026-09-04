import {nextTick} from "vue";

import socket from "../socket";
import eventbus from "../eventbus";
import {store} from "../store";
import {markMsgsRaw, pushMany} from "../chan";

socket.on("history:around", async (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	if (!data.messages.length) {
		channel.historyLoading = false;
		return;
	}

	// Jump semantics: the visible window is replaced, not merged - the
	// around-window is anchored on a stable storage id, so merging by
	// session id would duplicate messages.
	channel.scrolledToBottom = false;
	channel.messages = markMsgsRaw(data.messages);
	channel.moreHistoryAvailable = data.hasMoreBefore;
	channel.newerMessagesAvailable = data.hasMoreAfter;
	channel.historyLoading = false;

	await nextTick();

	// Lets MessageList scroll a pending focus target into view: the focus
	// request always originates from the mounted view itself, but the
	// response lands a round-trip later.
	eventbus.emit("history:around:applied", {chan: data.chan});
});

socket.on("history:newer", async (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	pushMany(channel.messages, markMsgsRaw(data.messages));
	channel.newerMessagesAvailable = data.hasMoreAfter;
	channel.scrolledToBottom = !data.hasMoreAfter;
	channel.historyLoading = false;

	await nextTick();
});

socket.on("history:latest", async (data) => {
	const channel = store.getters.findChannel(data.chan)?.channel;

	if (!channel) {
		return;
	}

	channel.messages = markMsgsRaw(data.messages);
	channel.moreHistoryAvailable = data.totalMessages > data.messages.length;
	channel.newerMessagesAvailable = false;
	channel.scrolledToBottom = true;
	channel.historyLoading = false;

	await nextTick();
});
