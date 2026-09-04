import fuzzy from "fuzzy";
import {ChanType} from "../../shared/types/chan";
import type {ClientChan, ClientNetwork} from "./types";

// A palette entry: what it shows and what selecting it means. The `run`
// payload is interpreted by the component (switch channel, prefill input,
// navigate, toggle a popup) - this module only builds and ranks entries so
// it stays unit-testable without a DOM or a store.
export type PaletteItem = {
	kind: "channel" | "command" | "navigation";
	// Primary label, fuzzy-matched.
	title: string;
	// Secondary context, also fuzzy-matched (network name, hint text).
	subtitle: string;
	chanId?: number;
	command?: string;
	route?: string;
	event?: string;
	unread?: number;
};

export type PaletteSource = {
	networks: Pick<ClientNetwork, "name" | "channels">[];
	commands: string[];
};

const navigationItems: PaletteItem[] = [
	{kind: "navigation", title: "Open settings", subtitle: "general", route: "/settings/general"},
	{
		kind: "navigation",
		title: "Open appearance settings",
		subtitle: "",
		route: "/settings/appearance",
	},
	{
		kind: "navigation",
		title: "Open notification settings",
		subtitle: "",
		route: "/settings/notifications",
	},
	{kind: "navigation", title: "Open account settings", subtitle: "", route: "/settings/account"},
	{kind: "navigation", title: "Connect to a network", subtitle: "add server", route: "/connect"},
	{kind: "navigation", title: "Show mentions", subtitle: "popup", event: "mentions:toggle"},
	{kind: "navigation", title: "Open help", subtitle: "commands", route: "/help"},
	{kind: "navigation", title: "Open changelog", subtitle: "updates", route: "/changelog"},
];

export function buildPaletteItems(source: PaletteSource): PaletteItem[] {
	const items: PaletteItem[] = [];

	for (const network of source.networks) {
		for (const channel of network.channels as ClientChan[]) {
			if (channel.type === ChanType.SPECIAL) {
				continue;
			}

			items.push({
				kind: "channel",
				title: channel.name,
				subtitle: network.name,
				chanId: channel.id,
				unread: channel.unread,
			});
		}
	}

	for (const command of source.commands) {
		items.push({
			kind: "command",
			title: command,
			subtitle: "insert into input",
			command,
		});
	}

	items.push(...navigationItems);

	return items;
}

// Ranked fuzzy filter: substring matches first (in original order), then
// fuzzy matches. Empty query returns everything unranked (channels first,
// as built above).
export function filterPaletteItems(query: string, items: PaletteItem[]): PaletteItem[] {
	const term = query.trim().toLowerCase();

	if (!term) {
		return items;
	}

	const substrings: PaletteItem[] = [];
	const fuzzyHits: {item: PaletteItem; score: number}[] = [];

	for (const item of items) {
		const haystack = `${item.title} ${item.subtitle}`.toLowerCase();

		if (haystack.includes(term)) {
			substrings.push(item);
			continue;
		}

		if (fuzzy.test(term, item.title) || fuzzy.test(term, item.subtitle)) {
			const titleMatch = fuzzy.match(term, item.title, {pre: "", post: ""});
			const subtitleMatch = fuzzy.match(term, item.subtitle, {
				pre: "",
				post: "",
			});
			const score = Math.max(titleMatch?.score ?? 0, subtitleMatch?.score ?? 0);
			fuzzyHits.push({item, score});
		}
	}

	fuzzyHits.sort((a, b) => b.score - a.score);

	return [...substrings, ...fuzzyHits.map((hit) => hit.item)];
}
