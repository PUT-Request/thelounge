<template>
	<div v-if="isStale" class="stale-build-banner">
		A new version of the UI is available.
		<button type="button" class="btn btn-small" @click="reload">Reload</button>
	</div>
</template>

<style>
.stale-build-banner {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 6px 12px;
	background-color: var(--highlight-bg-color);
	color: var(--body-color);
	font-size: 13px;
}
</style>

<script lang="ts">
import {defineComponent} from "vue";
import {isStale} from "../js/buildStaleness";

export default defineComponent({
	name: "StaleBuildBanner",
	setup() {
		const reload = () => {
			window.location.reload();
		};

		return {
			isStale,
			reload,
		};
	},
});
</script>
