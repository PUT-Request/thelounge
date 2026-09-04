<template>
	<form
		:class="['message-search', {opened: searchOpened, inline: onSearchPage}]"
		@submit.prevent="searchMessages"
	>
		<div class="input-wrapper">
			<input
				ref="searchInputField"
				v-model="searchInput"
				type="search"
				name="search"
				class="input"
				placeholder="Search messages…"
				@blur="closeSearch"
				@keyup.esc="closeSearch"
				@input="resumedFromCache = false"
			/>
		</div>
		<span v-if="showResumeHint" class="resume-hint">
			Continue search<template v-if="resumeResultCount !== null">
				({{ resumeResultCount }} result{{ resumeResultCount === 1 ? "" : "s" }})</template
			>
		</span>
		<button
			v-if="!onSearchPage"
			class="search"
			type="button"
			aria-label="Search messages in this channel"
			@mousedown.prevent="toggleSearch"
		/>
	</form>
</template>

<style>
form.message-search {
	display: flex;
}

form.message-search .input-wrapper {
	display: flex;
}

form.message-search input {
	width: 100%;
	height: auto !important;
	margin: 7px 0;
	border: 0;
	color: inherit;
	background-color: #fafafa;
	appearance: none;
}

form.message-search input::placeholder {
	color: rgba(0, 0, 0, 0.35);
}

@media (min-width: 480px) {
	form.message-search input {
		min-width: 140px;
	}

	form.message-search input:focus {
		min-width: 220px;
	}
}

form.message-search .input-wrapper {
	position: absolute;
	top: 45px;
	left: 0;
	right: 0;
	z-index: 1;
	height: 0;
	overflow: hidden;
	background: var(--window-bg-color);
}

form.message-search .input-wrapper input {
	margin: 7px;
}

form.message-search.opened .input-wrapper {
	height: 50px;
}

/* A small tab hanging directly off the bottom of the input so a prefilled
   term reads as a resumed session rather than a stale value. Positioned
   against the same coordinate space .input-wrapper uses. */
form.message-search .resume-hint {
	position: absolute;
	left: 7px;
	top: 95px;
	padding: 1px 6px;
	border: 1px solid #cdd3da;
	border-top: none;
	border-radius: 0 0 3px 3px;
	background-color: #fafafa;
	color: var(--body-color-muted);
	font-size: 11px;
	line-height: 1.3;
	white-space: nowrap;
	pointer-events: none;
	cursor: default;
}

/* On the search results page the form is always "open" and sits inline in
   the header next to the date picker and close button, rather than as a
   toggled full-width dropdown - so lay it out normally instead of via the
   absolute overlay above. */
form.message-search.inline {
	position: relative;
	flex-shrink: 0;
}

form.message-search.inline .input-wrapper {
	position: relative;
	top: auto;
	left: auto;
	right: auto;
	z-index: auto;
	height: auto;
	overflow: visible;
	background: none;
	width: 180px;
	transition: width 0.15s;
}

form.message-search.inline .input-wrapper:focus-within {
	width: 220px;
}

form.message-search.inline .input-wrapper input {
	margin: 0 6px;
	min-width: 0;
}

form.message-search.inline .resume-hint {
	left: 6px;
	top: 100%;
}

#chat form.message-search button {
	display: flex;
	color: #607992;
}
</style>

<script lang="ts">
import {computed, defineComponent, onMounted, PropType, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import eventbus from "../js/eventbus";
import {useStore} from "../js/store";
import {ClientNetwork, ClientChan} from "../js/types";

export default defineComponent({
	name: "MessageSearchForm",
	props: {
		network: {type: Object as PropType<ClientNetwork>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
	},
	setup(props) {
		const store = useStore();
		const searchOpened = ref(false);
		const searchInput = ref("");
		const resumedFromCache = ref(false);
		const resumeResultCount = ref<number | null>(null);
		const router = useRouter();
		const route = useRoute();

		const searchInputField = ref<HTMLInputElement | null>(null);

		const onSearchPage = computed(() => {
			return route.name === "SearchResults";
		});

		// Shown when the input was prefilled from the cached session (see
		// onMounted), so it reads as "continue" rather than a stale value.
		const showResumeHint = computed(
			() => resumedFromCache.value && searchInput.value.length > 0
		);

		watch(route, (newValue) => {
			if (newValue.query.q) {
				searchInput.value = String(newValue.query.q);
				resumedFromCache.value = false;
			}
		});

		onMounted(() => {
			searchInput.value = String(route.query.q || "");

			if (!searchInput.value) {
				// This form is rendered separately by the chat view and the
				// search results view (two distinct instances, not one that
				// persists across the route swap): reopening search from the
				// chat view mounts a fresh instance with an empty box, since
				// route.query.q only exists while on the SearchResults route.
				// Fall back to the last completed search's term for the
				// current network/channel, which doSearch() restores from.
				const cached = store.state.messageSearchResults;

				if (
					cached &&
					cached.results.length > 0 &&
					cached.query.networkUuid === props.network.uuid &&
					cached.query.channelName === props.channel.name
				) {
					searchInput.value = cached.query.searchTerm;
					resumeResultCount.value = cached.results.length;
					resumedFromCache.value = true;
				}
			}

			searchOpened.value = onSearchPage.value;

			if (searchInputField.value && !searchInput.value && searchOpened.value) {
				searchInputField.value.focus();
			}
		});

		const closeSearch = () => {
			if (!onSearchPage.value) {
				searchInput.value = "";
				searchOpened.value = false;
			}
		};

		const toggleSearch = () => {
			if (searchOpened.value) {
				searchInputField.value?.blur();
				return;
			}

			searchOpened.value = true;
			searchInputField.value?.focus();
		};

		const searchMessages = (event: Event) => {
			event.preventDefault();

			if (!searchInput.value) {
				return;
			}

			router
				.push({
					name: "SearchResults",
					params: {
						id: props.channel.id,
					},
					query: {
						q: searchInput.value,
					},
				})
				.catch((err) => {
					if (err.name === "NavigationDuplicated") {
						// Search for the same query again
						eventbus.emit("re-search");
					}
				});
		};

		return {
			searchOpened,
			searchInput,
			searchInputField,
			resumedFromCache,
			resumeResultCount,
			showResumeHint,
			closeSearch,
			toggleSearch,
			searchMessages,
			onSearchPage,
		};
	},
});
</script>
