import {markRaw, reactive} from "vue";
import {ClientChan, ClientMessage} from "./types";
import {SharedNetworkChan} from "../../shared/types/network";
import {SharedMsg} from "../../shared/types/msg";
import {ChanType} from "../../shared/types/chan";
import {extractInputHistory} from "./helpers/inputHistory";

// Messages are effectively immutable once created - the one exception is
// `previews`, which is genuinely mutated in place after insertion (shown/
// hidden toggling and thumbnail load state in LinkPreview*.vue, plus the
// /expand and /collapse commands) and needs to stay reactive for those to
// keep working. `markRaw` stops Vue from auto-wrapping *anything* nested
// under a message, so `previews` has to be wrapped explicitly, before the
// message itself is marked raw - only the immutable rest of the message
// (from/text/target/etc.) opts out of Vue's deep-reactivity Proxy wrapping,
// which is pure overhead for fields that never change. Apply this at every
// point a message enters a channel's `messages` array.
export function markMsgRaw<T extends SharedMsg>(msg: T): T {
	if (msg.previews) {
		msg.previews = reactive(msg.previews) as typeof msg.previews;
	}

	return markRaw(msg);
}

export function markMsgsRaw<T extends SharedMsg>(msgs: T[]): T[] {
	return msgs.map(markMsgRaw);
}

// `target.unshift(...items)` (or any spread into a function call) blows the
// call stack once `items` gets large enough - each JS engine caps how many
// arguments a single call can take (V8 throws "Maximum call stack size
// exceeded" somewhere in the tens-of-thousands), and a channel loaded with
// a large history can hand back a single batch well past that. Prepending
// or appending in bounded chunks keeps the same array reference (required
// for reactive arrays like a channel's `messages`, where callers hold onto
// that exact object) while never spreading more than a small, fixed number
// of arguments at once.
const APPEND_CHUNK_SIZE = 1000;

export function unshiftMany<T>(target: T[], items: T[]): void {
	for (let end = items.length; end > 0; end -= APPEND_CHUNK_SIZE) {
		const start = Math.max(0, end - APPEND_CHUNK_SIZE);
		target.splice(0, 0, ...items.slice(start, end));
	}
}

export function pushMany<T>(target: T[], items: T[]): void {
	for (let start = 0; start < items.length; start += APPEND_CHUNK_SIZE) {
		target.push(...items.slice(start, start + APPEND_CHUNK_SIZE));
	}
}

export function toClientChan(shared: SharedNetworkChan): ClientChan {
	const history: string[] = [""].concat(extractInputHistory(shared.messages, 99));
	// filter the unused vars
	const {messages, totalMessages: _, ...props} = shared;
	const channel: ClientChan = {
		...props,
		editTopic: false,
		pendingMessage: "",
		inputHistoryPosition: 0,
		historyLoading: false,
		scrolledToBottom: true,
		typingNicks: [],
		users: [],
		usersOutdated: shared.type === ChanType.CHANNEL ? true : false,
		moreHistoryAvailable: shared.totalMessages > shared.messages.length,
		newerMessagesAvailable: false,
		inputHistory: history,
		replyingTo: null,
		messages: markMsgsRaw(sharedMsgToClientMsg(messages)),
	};
	return channel;
}

function sharedMsgToClientMsg(shared: SharedMsg[]): ClientMessage[] {
	// TODO: this is a stub for now, we will want to populate client specific stuff here
	return shared;
}
