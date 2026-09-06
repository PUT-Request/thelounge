import storage from "../localStorage";

import type {ClientNetwork} from "../types";

type CollapsibleNetwork = Pick<ClientNetwork, "uuid" | "isCollapsed">;

/**
 * Persists a network's collapsed state to localStorage.
 *
 * Never throws: a corrupt or non-array stored payload is ignored (treated as
 * empty) so a single bad localStorage value cannot break sidebar rendering.
 *
 * @param network Network whose `isCollapsed` flag is updated in place.
 * @param isCollapsed Whether the network should be stored as collapsed.
 */
export default (network: CollapsibleNetwork, isCollapsed: boolean): void => {
	let stored: string | null = null;

	try {
		stored = storage.get("thelounge.networks.collapsed");
	} catch {
		stored = null;
	}

	let collapsedUuids: string[] = [];

	if (stored) {
		try {
			const parsed: unknown = JSON.parse(stored);

			if (Array.isArray(parsed)) {
				collapsedUuids = parsed.filter(
					(uuid): uuid is string => typeof uuid === "string"
				);
			}
		} catch {
			collapsedUuids = [];
		}
	}

	const networks = new Set(collapsedUuids);

	network.isCollapsed = isCollapsed;

	if (isCollapsed) {
		networks.add(network.uuid);
	} else {
		networks.delete(network.uuid);
	}

	try {
		storage.set("thelounge.networks.collapsed", JSON.stringify([...networks]));
	} catch {
		// Storage full or blocked: in-memory state above is still updated.
	}
};
