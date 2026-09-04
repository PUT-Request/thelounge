<template>
	<div class="palette-overlay" @click.self="close">
		<div class="palette" role="dialog" aria-modal="true" aria-label="Quick switcher">
			<input
				ref="paletteInput"
				v-model="query"
				type="text"
				class="input"
				placeholder="Type a channel, command, or action…"
				aria-label="Quick switcher search"
				autocomplete="off"
				spellcheck="false"
				@keydown.down.prevent="moveActive(1)"
				@keydown.up.prevent="moveActive(-1)"
				@keydown.enter.prevent="selectActive"
				@keydown.esc="close"
			/>
			<div v-if="results.length" class="palette-results" role="listbox">
				<div
					v-for="(item, index) in results"
					:key="
						item.kind + ':' + (item.chanId ?? item.command ?? item.route ?? item.title)
					"
					:ref="(el) => setRowRef(el as HTMLElement, index)"
					:class="['palette-item', {active: index === activeIndex}]"
					role="option"
					:aria-selected="index === activeIndex"
					@click="select(item)"
					@mousemove="activeIndex = index"
				>
					<span class="palette-kind">{{ kindLabel(item.kind) }}</span>
					<span class="palette-title">{{ item.title }}</span>
					<span v-if="item.subtitle" class="palette-subtitle">{{ item.subtitle }}</span>
					<span v-if="item.unread" class="palette-unread">{{ item.unread }}</span>
				</div>
			</div>
			<div v-else class="palette-empty">No matches</div>
			<div class="palette-footer">
				<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
				<span><kbd>↵</kbd> select</span>
				<span><kbd>esc</kbd> close</span>
			</div>
		</div>
	</div>
</template>

<style>
.palette-overlay {
	position: fixed;
	inset: 0;
	z-index: 10;
	display: flex;
	justify-content: center;
	align-items: flex-start;
	padding-top: 12vh;
	background-color: rgb(0 0 0 / 45%);
}

.palette {
	width: min(560px, calc(100vw - 32px));
	max-height: 60vh;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border-radius: 6px;
	background-color: var(--window-bg-color);
	box-shadow: 0 12px 40px rgb(0 0 0 / 35%);
}

.palette .input {
	border: 0;
	border-bottom: 1px solid var(--highlight-border-color);
	border-radius: 6px 6px 0 0;
	padding: 12px 14px;
	font-size: 15px;
}

.palette-results {
	overflow-y: auto;
	padding: 6px;
}

.palette-item {
	display: flex;
	align-items: baseline;
	gap: 8px;
	padding: 7px 10px;
	border-radius: 4px;
	cursor: pointer;
}

.palette-item.active {
	background-color: var(--highlight-bg-color);
}

.palette-kind {
	flex-shrink: 0;
	width: 74px;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--body-color-muted);
}

.palette-title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.palette-subtitle {
	margin-left: auto;
	flex-shrink: 0;
	font-size: 12px;
	color: var(--body-color-muted);
}

.palette-unread {
	flex-shrink: 0;
	min-width: 20px;
	text-align: center;
	font-size: 12px;
	border-radius: 10px;
	background-color: var(--highlight-border-color);
	color: var(--window-bg-color);
	padding: 0 6px;
}

.palette-empty {
	padding: 14px;
	text-align: center;
	color: var(--body-color-muted);
}

.palette-footer {
	display: flex;
	gap: 14px;
	padding: 8px 14px;
	border-top: 1px solid var(--highlight-border-color);
	font-size: 12px;
	color: var(--body-color-muted);
}

.palette-footer kbd {
	border: 1px solid var(--highlight-border-color);
	border-radius: 3px;
	padding: 0 4px;
	margin-right: 3px;
	font-family: inherit;
}
</style>

<script lang="ts">
import {computed, defineComponent, nextTick, onMounted, ref, watch} from "vue";
import {useRouter} from "vue-router";
import constants from "../js/constants";
import eventbus from "../js/eventbus";
import {switchToChannel} from "../js/router";
import {useStore} from "../js/store";
import {buildPaletteItems, filterPaletteItems, PaletteItem} from "../js/palette";

export default defineComponent({
	name: "CommandPalette",
	emits: ["close"],
	setup(_, {emit}) {
		const store = useStore();
		const router = useRouter();

		const query = ref("");
		const activeIndex = ref(0);
		const paletteInput = ref<HTMLInputElement | null>(null);
		const rowRefs = ref<(HTMLElement | null)[]>([]);

		const items = computed(() =>
			buildPaletteItems({
				networks: store.state.networks,
				commands: constants.commands,
			})
		);

		const results = computed(() => filterPaletteItems(query.value, items.value));

		const close = () => emit("close");

		const setRowRef = (el: HTMLElement | null, index: number) => {
			rowRefs.value[index] = el;
		};

		const moveActive = (delta: number) => {
			if (!results.value.length) {
				return;
			}

			activeIndex.value =
				(activeIndex.value + delta + results.value.length) % results.value.length;

			void nextTick(() => {
				rowRefs.value[activeIndex.value]?.scrollIntoView({block: "nearest"});
			});
		};

		const kindLabel = (kind: PaletteItem["kind"]) =>
			kind === "channel" ? "channel" : kind === "command" ? "command" : "go to";

		const select = (item: PaletteItem) => {
			if (item.kind === "channel" && item.chanId !== undefined) {
				const found = store.getters.findChannel(item.chanId);

				if (found) {
					switchToChannel(found.channel);
				}
			} else if (item.kind === "command" && item.command) {
				eventbus.emit("chatinput:prefill", {text: `${item.command} `});
			} else if (item.route) {
				router.push(item.route).catch(() => {
					// already there - harmless
				});
			} else if (item.event) {
				eventbus.emit(item.event);
			}

			close();
		};

		const selectActive = () => {
			const item = results.value[activeIndex.value];

			if (item) {
				select(item);
			}
		};

		watch(query, () => {
			activeIndex.value = 0;
		});

		watch(results, () => {
			if (activeIndex.value >= results.value.length) {
				activeIndex.value = Math.max(0, results.value.length - 1);
			}
		});

		onMounted(() => {
			paletteInput.value?.focus();
		});

		return {
			query,
			activeIndex,
			paletteInput,
			results,
			close,
			setRowRef,
			moveActive,
			kindLabel,
			select,
			selectActive,
		};
	},
});
</script>
