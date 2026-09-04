import constants from "./constants";

import {createRouter, createWebHashHistory} from "vue-router";
import SignIn from "../components/Windows/SignIn.vue";
import Connect from "../components/Windows/Connect.vue";
import Settings from "../components/Windows/Settings.vue";
import Help from "../components/Windows/Help.vue";
import Changelog from "../components/Windows/Changelog.vue";
import NetworkEdit from "../components/Windows/NetworkEdit.vue";
import SearchResults from "../components/Windows/SearchResults.vue";
import RoutedChat from "../components/RoutedChat.vue";
import {store} from "./store";

import AppearanceSettings from "../components/Settings/Appearance.vue";
import GeneralSettings from "../components/Settings/General.vue";
import AccountSettings from "../components/Settings/Account.vue";
import NotificationSettings from "../components/Settings/Notifications.vue";
import {ClientChan} from "./types";
import {shouldShowGeneralSettings} from "./helpers/settingsTabs";

const router = createRouter({
	history: createWebHashHistory(),
	routes: [
		{
			name: "SignIn",
			path: "/sign-in",
			component: SignIn,
			beforeEnter(to, from, next) {
				// Prevent navigating to sign-in when already signed in
				if (store.state.appLoaded) {
					next(false);
					return;
				}

				next();
			},
		},
		{
			name: "Connect",
			path: "/connect",
			component: Connect,
			props: (route) => ({queryParams: route.query}),
		},
		{
			path: "/settings",
			component: Settings,
			children: [
				{
					name: "Appearance",
					path: "",
					component: AppearanceSettings,
				},
				{
					name: "Notifications",
					path: "notifications",
					component: NotificationSettings,
				},
				{
					name: "General",
					path: "general",
					component: GeneralSettings,
					beforeEnter(to, from, next) {
						if (!shouldShowGeneralSettings()) {
							next({name: "Appearance"});
							return;
						}

						next();
					},
				},
				{
					name: "Account",
					path: "account",
					component: AccountSettings,
					props: true,
				},
				{
					// Appearance used to live here, keep old links working
					path: "appearance",
					redirect: {name: "Appearance"},
				},
			],
		},
		{
			name: "Help",
			path: "/help",
			component: Help,
		},
		{
			name: "Changelog",
			path: "/changelog",
			component: Changelog,
		},
		{
			name: "NetworkEdit",
			path: "/edit-network/:uuid",
			component: NetworkEdit,
		},
		{
			name: "RoutedChat",
			path: "/chan-:id",
			component: RoutedChat,
		},
		{
			name: "SearchResults",
			path: "/chan-:id/search",
			component: SearchResults,
		},
	],
});

router.beforeEach((to, from, next) => {
	// If user is not yet signed in, wait for appLoaded state to change
	// unless they are trying to open SignIn (which can be triggered in auth.js)
	if (!store.state.appLoaded && to.name !== "SignIn") {
		store.watch(
			(state) => state.appLoaded,
			() => next()
		);

		return;
	}

	next();
});

router.beforeEach((to, from) => {
	// Disallow navigating to non-existing routes
	if (!to.matched.length) {
		return false;
	}

	// Disallow navigating to invalid channels
	if (to.name === "RoutedChat" && !store.getters.findChannel(Number(to.params.id))) {
		return false;
	}

	// Disallow navigating to invalid networks
	if (to.name === "NetworkEdit" && !store.getters.findNetwork(String(to.params.uuid))) {
		return false;
	}

	return true;
});

// MRU of recently-active channel ids that skip the trim-to-100 below.
// Module-level (not in the store): purely a local memory-management
// structure, never synced or persisted.
const warmChannelIds: number[] = [];

router.afterEach((to) => {
	if (store.state.appLoaded) {
		if (window.innerWidth <= constants.mobileViewportPixels) {
			store.commit("sidebarOpen", false);
		}
	}

	if (store.state.activeChannel) {
		const channel = store.state.activeChannel.channel;

		if (to.name !== "RoutedChat") {
			store.commit("activeChannel", undefined);
		}

		// When switching out of a channel, mark everything as read
		if (channel.messages?.length > 0) {
			channel.firstUnread = channel.messages[channel.messages.length - 1].id;
		}

		// Recently-left channels stay fully loaded in memory so bouncing
		// between a handful of channels is instant; only channels that age
		// out of this MRU are trimmed back to their last 100 messages
		// (which re-fetch from the server on scroll-up). 0 restores the old
		// trim-on-every-switch behavior. See Settings -> General.
		const rawLimit = store.state.settings.warmChannels;
		const warmLimit = typeof rawLimit === "number" ? rawLimit : 5;

		const knownAt = warmChannelIds.indexOf(channel.id);

		if (knownAt >= 0) {
			warmChannelIds.splice(knownAt, 1);
		}

		warmChannelIds.unshift(channel.id);

		if (warmChannelIds.length > warmLimit) {
			const evicted = warmChannelIds.splice(warmLimit);

			for (const id of evicted) {
				const evictedChannel = store.getters.findChannel(id)?.channel;

				if (evictedChannel && evictedChannel.messages?.length > 100) {
					evictedChannel.messages.splice(0, evictedChannel.messages.length - 100);
					evictedChannel.moreHistoryAvailable = true;
				}
			}
		}
	}
});

async function navigate(
	routeName: string,
	params: any = {},
	query: Record<string, number | undefined> = {}
) {
	if (router.currentRoute.value.name) {
		await router.push({name: routeName, params, query});
	} else {
		// If current route is null, replace the history entry
		// This prevents invalid entries from lingering in history,
		// and then the route guard preventing proper navigation
		await router.replace({name: routeName, params, query}).catch(() => {});
	}
}

function switchToChannel(channel: ClientChan, message?: {id?: number; storageId?: number}) {
	void navigate(
		"RoutedChat",
		{id: channel.id},
		message
			? {
					focused: message.id,
					focusedStorageId: message.storageId,
			  }
			: {}
	);
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data && event.data.type === "open") {
			const id = parseInt(event.data.channel.substring(5), 10); // remove "chan-" prefix

			const channelTarget = store.getters.findChannel(id);

			if (channelTarget) {
				switchToChannel(channelTarget.channel, {
					id: event.data.msgId,
					storageId: event.data.storageId,
				});
			}
		}
	});
}

export {router, navigate, switchToChannel};
