<template>
	<div ref="chat" class="chat" tabindex="-1">
		<h3 class="sr-only">Chat Messages</h3>
		<div v-show="channel.moreHistoryAvailable" class="show-more">
			<button
				ref="loadMoreButton"
				:disabled="channel.historyLoading || !store.state.isConnected"
				class="btn"
				@click="onShowMoreClick"
			>
				<span v-if="channel.historyLoading">Loading…</span>
				<span v-else>Show older messages</span>
			</button>
		</div>
		<div
			class="messages"
			role="log"
			aria-live="polite"
			aria-relevant="additions"
			:style="{
				position: 'relative',
				height: totalSize + 'px',
				padding: 0,
			}"
			@copy="onCopy"
		>
			<div
				v-for="virtualRow in virtualItems"
				:key="virtualRow.key"
				:ref="(el) => rowVirtualizer.measureElement(el as Element)"
				:data-index="virtualRow.index"
				:style="{
					position: 'absolute',
					top: 0,
					left: 0,
					width: '100%',
					transform: `translateY(${virtualRow.start + MESSAGES_PADDING}px)`,
					padding:
						'0 0 ' +
						(virtualRow.index === condensedMessages.length - 1 ? MESSAGES_PADDING : 0) +
						'px',
				}"
			>
				<DateMarker
					v-if="shouldDisplayDateMarker(entryAt(virtualRow.index), virtualRow.index)"
					:message="entryAt(virtualRow.index) as any"
					:focused="isFocusedEntry(virtualRow.index)"
				/>
				<h4 v-if="shouldDisplayUnreadMarker(virtualRow.index)" class="unread-marker">
					<span class="unread-marker-text">New messages</span>
				</h4>

				<MessageCondensed
					v-if="condensedGroupAt(virtualRow.index)"
					:network="network"
					:keep-scroll-position="keepScrollPosition"
					:messages="condensedGroupAt(virtualRow.index)!.messages"
					:focused="isFocusedEntry(virtualRow.index)"
				/>
				<Message
					v-else
					:channel="channel"
					:network="network"
					:message="messageAt(virtualRow.index)"
					:keep-scroll-position="keepScrollPosition"
					:is-previous-source="
						isPreviousSource(entryAt(virtualRow.index), virtualRow.index)
					"
					:focused="isFocusedEntry(virtualRow.index)"
					@toggle-link-preview="onLinkPreviewToggle"
				/>
			</div>
		</div>
		<div v-show="channel.newerMessagesAvailable" class="show-more">
			<button
				ref="loadNewerButton"
				:disabled="channel.historyLoading || !store.state.isConnected"
				class="btn"
				@click="onShowNewerClick"
			>
				<span v-if="channel.historyLoading">Loading…</span>
				<span v-else>Show newer messages</span>
			</button>
		</div>
	</div>
</template>

<script lang="ts">
import {MessageType, SharedMsg} from "../../shared/types/msg";
import eventbus from "../js/eventbus";
import clipboard from "../js/clipboard";
import socket from "../js/socket";
import Message from "./Message.vue";
import MessageCondensed from "./MessageCondensed.vue";
import DateMarker from "./DateMarker.vue";
import {
	useCondensedMessages,
	CondensedEntry,
	CondensedMessageContainer,
} from "../js/hooks/use-condensed-messages";
import {useVirtualizer} from "@tanstack/vue-virtual";
import {useRouter} from "vue-router";
import {
	computed,
	defineComponent,
	nextTick,
	onBeforeUnmount,
	onMounted,
	onUnmounted,
	PropType,
	ref,
	watch,
} from "vue";
import {useStore} from "../js/store";
import {ClientChan, ClientMessage, ClientNetwork, ClientLinkPreview} from "../js/types";

// Matches the previous (unvirtualized) `#chat .messages { padding: 10px 0; }`
// rule - absolutely-positioned rows don't respect that CSS padding (it
// applies to the containing block's padding edge, which is where `top: 0`
// starts from), so the equivalent inset is baked into row offsets/height here.
const MESSAGES_PADDING = 10;

export default defineComponent({
	name: "MessageList",
	components: {
		Message,
		MessageCondensed,
		DateMarker,
	},
	props: {
		network: {type: Object as PropType<ClientNetwork>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
		focused: Number,
		focusedStorageId: Number,
	},
	setup(props) {
		const store = useStore();
		const router = useRouter();

		const chat = ref<HTMLDivElement | null>(null);
		const loadMoreButton = ref<HTMLButtonElement | null>(null);
		const loadNewerButton = ref<HTMLButtonElement | null>(null);
		const historyObserver = ref<IntersectionObserver | null>(null);
		const skipNextScrollEvent = ref(false);

		const isWaitingForNextTick = ref(false);

		const onShowMoreClick = () => {
			if (!store.state.isConnected || props.channel.historyLoading) {
				return;
			}

			// Find the first message that isn't showInActive - if
			// showInActive is set, this message is actually in another channel
			const message = props.channel.messages.find((item) => !item.showInActive);

			props.channel.historyLoading = true;

			socket.emit("more", {
				target: props.channel.id,
				lastId: message?.id ?? -1,
				storageId: message?.storageId,
				condensed: store.state.settings.statusMessages !== "shown",
			});
		};

		const onShowNewerClick = () => {
			const message = props.channel.messages.at(-1);

			if (!store.state.isConnected || props.channel.historyLoading || !message) {
				return;
			}

			props.channel.historyLoading = true;
			socket.emit("history:newer", {
				target: props.channel.id,
				lastId: message.id,
				storageId: message.storageId,
			});
		};

		const onHistoryButtonObserved = (entries: IntersectionObserverEntry[]) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					if (entry.target === loadNewerButton.value) {
						onShowNewerClick();
					} else {
						onShowMoreClick();
					}
				}
			}
		};

		const observeHistoryButtons = () => {
			for (const button of [loadMoreButton.value, loadNewerButton.value]) {
				if (button) {
					historyObserver.value?.unobserve(button);
					historyObserver.value?.observe(button);
				}
			}
		};

		// The setup-level nextTick() below applies the initial scroll once
		// every definition it uses (observer callback, jumpToBottom,
		// virtualizer) exists - keep ordering in mind when moving blocks.

		// Maintains the condensed (status-message-folding) view incrementally
		// instead of rebuilding it from the whole array on every incoming
		// message - see use-condensed-messages.ts. A container holding a
		// single message stays wrapped here (unlike the old computed, which
		// unwrapped it); the template renders those as plain Messages.
		const {
			condensed: condensedMessages,
			rebuildAll: rebuildCondensed,
			appendOne: appendCondensed,
			prependChunk: prependCondensed,
		} = useCondensedMessages(
			() => props.channel,
			() => store.state.settings.statusMessages
		);

		// The first message object seen by the length watcher below. Object
		// identity (not id) classifies changes: prepends/appends mutate the
		// same array, so the old first message is still present by reference;
		// a wholesale window replace (history jump, reconnect with a
		// large gap) swaps in fresh objects and must rebuild instead.
		let prevFirstMessage: ClientMessage | null =
			props.channel.messages.length > 0 ? props.channel.messages[0] : null;

		const isMessageId = (value: unknown): value is number =>
			typeof value === "number" && Number.isSafeInteger(value) && value > 0;

		const getFocusedStorageId = () =>
			isMessageId(props.focusedStorageId) ? props.focusedStorageId : undefined;

		// A message is focused when it matches the focused storage id (stable
		// across reloads) or, when no storage id was given, the session id.
		const isFocused = (message: ClientMessage) => {
			const storageId = getFocusedStorageId();
			return storageId === undefined
				? message.id === props.focused
				: message.storageId === storageId;
		};

		const isFocusedEntry = (index: number): boolean => {
			const entry = condensedMessages[index];

			if (!entry) {
				return false;
			}

			return entry.type === "condensed"
				? entry.messages.some((m) => isFocused(m))
				: isFocused(entry);
		};

		const entryAt = (index: number) => condensedMessages[index];

		const condensedGroupAt = (index: number): CondensedMessageContainer | null => {
			const entry = condensedMessages[index];
			return entry.type === "condensed" && entry.messages.length > 1 ? entry : null;
		};

		const messageAt = (index: number): ClientMessage => {
			const entry = condensedMessages[index];
			return entry.type === "condensed" ? entry.messages[0] : entry;
		};

		// Every message in a channel's history used to be a real mounted DOM
		// node with no windowing, which froze the UI on large (maxHistory: -1)
		// channels. This renders only the rows near the viewport; heights vary
		// a lot (plain messages, async-loading link previews, collapsible
		// condensed groups) so sizes start as a rough estimate and are
		// corrected per-row by measureElement's ResizeObserver after mount.
		const getEntryKey = (entry: CondensedEntry): number =>
			entry.type === "condensed" && entry.messages.length > 1
				? entry.messages[0].id
				: (entry.id as number);

		// The whole options object must be wrapped in `computed()` (rather
		// than passed as a plain object with `condensedMessages.length` read
		// once at setup time) so @tanstack/vue-virtual re-subscribes whenever
		// the condensed view actually changes length.
		const rowVirtualizer = useVirtualizer(
			computed(() => ({
				count: condensedMessages.length,
				getScrollElement: () => chat.value,
				estimateSize: () => 28,
				overscan: 8,
				getItemKey: (index: number) => getEntryKey(condensedMessages[index]),
			}))
		);

		const virtualItems = computed(() => rowVirtualizer.value.getVirtualItems());
		const totalSize = computed(() => rowVirtualizer.value.getTotalSize() + MESSAGES_PADDING);

		const jumpToBottom = () => {
			skipNextScrollEvent.value = true;
			props.channel.scrolledToBottom = true;

			if (condensedMessages.length > 0) {
				rowVirtualizer.value.scrollToIndex(condensedMessages.length - 1, {align: "end"});
			}
		};

		const jumpToLatest = () => {
			if (!props.channel.newerMessagesAvailable) {
				jumpToBottom();
				return;
			}

			if (!store.state.isConnected || props.channel.historyLoading) {
				return;
			}

			props.channel.historyLoading = true;
			socket.emit("history:latest", {target: props.channel.id});
			// Drop the focus query: we are back at the live end, and keeping
			// it would re-trigger focusMessage on the next query change.
			void router.replace({name: "RoutedChat", params: {id: props.channel.id}});
		};

		const shouldDisplayDateMarker = (
			message: SharedMsg | CondensedMessageContainer,
			id: number
		) => {
			const previousMessage = condensedMessages[id - 1];

			if (!previousMessage) {
				return true;
			}

			const oldDate = new Date(previousMessage.time);
			const newDate = new Date(message.time);

			return (
				oldDate.getDate() !== newDate.getDate() ||
				oldDate.getMonth() !== newDate.getMonth() ||
				oldDate.getFullYear() !== newDate.getFullYear()
			);
		};

		const highestIdAt = (entry: CondensedEntry): number =>
			entry.type === "condensed"
				? (entry.id ?? entry.messages[entry.messages.length - 1].id)
				: entry.id;

		// Shows the unread marker exactly once, on the first entry (in array
		// order) whose highest contained message id crosses past firstUnread.
		// Index-independent (only ever looks at condensedMessages[index] and
		// condensedMessages[index - 1]) so it works under partial/out-of-order
		// virtualized rendering, unlike a shared "already shown this pass"
		// flag, which assumes a full top-to-bottom render every update.
		const shouldDisplayUnreadMarker = (index: number) => {
			// No marker while viewing history or a focused message: the
			// boundary it marks isn't in view, so it would just be noise.
			if (
				props.channel.newerMessagesAvailable ||
				isMessageId(props.focused) ||
				getFocusedStorageId() !== undefined
			) {
				return false;
			}

			const entry = condensedMessages[index];

			if (!entry || highestIdAt(entry) <= props.channel.firstUnread) {
				return false;
			}

			const previous = condensedMessages[index - 1];

			return !previous || highestIdAt(previous) <= props.channel.firstUnread;
		};

		const isPreviousSource = (currentMessage: CondensedEntry, id: number) => {
			const previousMessage = condensedMessages[id - 1];
			return (
				previousMessage &&
				currentMessage.type === MessageType.MESSAGE &&
				previousMessage.type === MessageType.MESSAGE &&
				currentMessage.from &&
				previousMessage.from &&
				currentMessage.from.nick === previousMessage.from.nick
			);
		};

		const onCopy = () => {
			if (chat.value) {
				clipboard(chat.value);
			}
		};

		const keepScrollPosition = async () => {
			// If we are already waiting for the next tick to force scroll position,
			// we have no reason to perform more checks and set it again in the next tick
			if (isWaitingForNextTick.value) {
				return;
			}

			const el = chat.value;

			if (!el) {
				return;
			}

			if (!props.channel.scrolledToBottom) {
				// No manual restore needed here for a prepend (loading older
				// history while scrolled up): the virtualizer already keeps the
				// viewport visually stable as newly-prepended rows above the
				// fold get measured for the first time - a second, manual
				// restore on top of that fights with it and makes the
				// scrollbar visibly jump back and forth as rows settle from
				// their estimated size to their real one.
				return;
			}

			isWaitingForNextTick.value = true;
			await nextTick();
			isWaitingForNextTick.value = false;

			jumpToBottom();
		};

		// Scroll to a focused message by id. The row may not be mounted
		// under virtualization (or the condensed rebuild for a just-applied
		// window may not have run yet), so locate its index and let the
		// virtualizer bring it into view, retrying across ticks.
		const scrollToMessageId = async (id: number) => {
			for (let attempt = 0; attempt < 5; attempt++) {
				const index = condensedMessages.findIndex((entry) =>
					entry.type === "condensed"
						? entry.messages.some((m) => m.id === id)
						: entry.id === id
				);

				if (index >= 0) {
					props.channel.scrolledToBottom = false;
					rowVirtualizer.value.scrollToIndex(index, {align: "center"});
					return;
				}

				await nextTick();
			}
		};

		let requestedFocus: number | undefined;
		let handledFocus: number | undefined;

		// Drive a ?focused[StorageId]= query into a jump: scroll when the
		// message is already loaded, otherwise fetch a window around it.
		// The around-response arrives a round-trip later and lands through
		// the history:around:applied listener below, which re-runs this.
		const focusMessage = async () => {
			const storageId = getFocusedStorageId();
			const focusId = storageId ?? props.focused;

			if (!isMessageId(focusId) || handledFocus === focusId) {
				return;
			}

			await nextTick();
			const message = props.channel.messages.find((item) => isFocused(item));

			if (message) {
				handledFocus = focusId;
				void scrollToMessageId(message.id);
				return;
			}

			if (requestedFocus !== focusId) {
				requestedFocus = focusId;
				props.channel.historyLoading = true;
				socket.emit("history:around", {
					target: props.channel.id,
					msgId: props.focused,
					storageId,
				});
			}
		};

		const onHistoryAroundApplied = (data: {chan: number}) => {
			if (data.chan !== props.channel.id) {
				return;
			}

			void focusMessage();
		};

		nextTick(() => {
			if (!chat.value) {
				return;
			}

			if (window.IntersectionObserver) {
				historyObserver.value = new window.IntersectionObserver(onHistoryButtonObserved, {
					root: chat.value,
				});
			}

			if (isMessageId(props.focused) || getFocusedStorageId() !== undefined) {
				void focusMessage();
			} else {
				jumpToBottom();
			}
		}).catch((e) => {
			// eslint-disable-next-line no-console
			console.error("Error in new IntersectionObserver", e);
		});

		const onLinkPreviewToggle = async (preview: ClientLinkPreview, message: ClientMessage) => {
			await keepScrollPosition();

			// Tell the server we're toggling so it remembers at page reload
			socket.emit("msg:preview:toggle", {
				target: props.channel.id,
				msgId: message.id,
				link: preview.link,
				shown: preview.shown,
			});
		};

		const handleScroll = () => {
			// Setting scrollTop also triggers scroll event
			// We don't want to perform calculations for that
			if (skipNextScrollEvent.value) {
				skipNextScrollEvent.value = false;
				return;
			}

			const el = chat.value;

			if (!el) {
				return;
			}

			props.channel.scrolledToBottom = el.scrollHeight - el.scrollTop - el.offsetHeight <= 30;
		};

		const handleResize = () => {
			// Keep message list scrolled to bottom on resize
			if (props.channel.scrolledToBottom) {
				jumpToBottom();
			}
		};

		onMounted(() => {
			chat.value?.addEventListener("scroll", handleScroll, {passive: true});

			eventbus.on("resize", handleResize);
			eventbus.on("history:around:applied", onHistoryAroundApplied);

			void nextTick(() => {
				observeHistoryButtons();
			});
		});

		watch(
			() => props.channel.id,
			() => {
				props.channel.scrolledToBottom = true;

				// A new channel means a new focus context: drop the guards so
				// an identical focus id still triggers handling here.
				requestedFocus = undefined;
				handledFocus = undefined;

				// Switching channels swaps in a whole different messages
				// array - rebuild the condensed view for it outright rather
				// than trying to classify this as a prepend/append.
				rebuildCondensed();
				prevFirstMessage =
					props.channel.messages.length > 0 ? props.channel.messages[0] : null;

				// The virtualizer's measurement cache is keyed by message id,
				// which is only unique within a channel - clear it so the new
				// channel's rows don't briefly render at a previous channel's
				// (possibly numerically colliding) cached heights.
				rowVirtualizer.value.measure();

				// Re-add the intersection observer to trigger the check again on channel switch
				// Otherwise if last channel had the button visible, switching to a new channel won't trigger the history
				observeHistoryButtons();
			}
		);

		// A focus query can arrive while this view stays mounted (jumping
		// between two messages of the same channel): re-run focus handling
		// instead of relying on the mount path alone. Clearing the query
		// (back at the live end) resets the guards so a later jump works.
		watch([() => props.focused, () => props.focusedStorageId], () => {
			if (!isMessageId(props.focused) && getFocusedStorageId() === undefined) {
				requestedFocus = undefined;
				handledFocus = undefined;
				return;
			}

			void focusMessage();
		});

		// Single watcher classifying every channel.messages change as a
		// tail-append, a head-prepend, or anything else (window replace,
		// client-side trim, history clear), updating the condensed view
		// incrementally instead of rebuilding it from scratch each time.
		watch(
			() => props.channel.messages.length,
			(newLen, oldLen) => {
				const messages = props.channel.messages;
				const newFirst = messages.length > 0 ? messages[0] : null;
				const continued = oldLen !== undefined && newLen > oldLen;
				const isPrepend =
					continued && prevFirstMessage !== null && newFirst !== prevFirstMessage;
				// A pure tail-append keeps the same first message object;
				// anything else that grows the array swapped the window.
				const isAppend = continued && !isPrepend && newFirst === prevFirstMessage;

				if (isPrepend) {
					prependCondensed(newLen - (oldLen ?? 0));
				} else if (isAppend) {
					const addedCount = newLen - (oldLen ?? 0);

					if (addedCount === 1) {
						appendCondensed(messages[messages.length - 1]);
					} else if (addedCount > 0 && addedCount <= 20) {
						for (let i = messages.length - addedCount; i < messages.length; i++) {
							appendCondensed(messages[i]);
						}
					} else {
						rebuildCondensed();
					}
				} else {
					// Window replace, client-side trim, history clear, or
					// anything else ambiguous - safe, infrequent fallback.
					rebuildCondensed();
				}

				prevFirstMessage = newFirst;
			}
		);

		watch(
			() => store.state.settings.statusMessages,
			() => {
				rebuildCondensed();
			}
		);

		watch(
			() => props.channel.messages.length,
			async () => {
				await keepScrollPosition();
			}
		);

		watch(
			() => props.channel.pendingMessage,
			async () => {
				// Keep the scroll stuck when input gets resized while typing
				await keepScrollPosition();
			}
		);

		onBeforeUnmount(() => {
			eventbus.off("resize", handleResize);
			eventbus.off("history:around:applied", onHistoryAroundApplied);
			chat.value?.removeEventListener("scroll", handleScroll);
		});

		onUnmounted(() => {
			if (historyObserver.value) {
				historyObserver.value.disconnect();
			}
		});

		return {
			chat,
			store,
			onShowMoreClick,
			onShowNewerClick,
			loadMoreButton,
			loadNewerButton,
			onCopy,
			condensedMessages,
			entryAt,
			condensedGroupAt,
			messageAt,
			rowVirtualizer,
			virtualItems,
			totalSize,
			MESSAGES_PADDING,
			shouldDisplayDateMarker,
			shouldDisplayUnreadMarker,
			isFocusedEntry,
			keepScrollPosition,
			isPreviousSource,
			jumpToBottom,
			jumpToLatest,
			onLinkPreviewToggle,
		};
	},
});
</script>
