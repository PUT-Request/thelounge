import {store} from "../store";

import type {ClientChan, ClientNetwork} from "../types";
import {ChanType} from "../../../shared/types/chan";

/**
 * Checks whether a channel should render collapsed under a collapsed network.
 *
 * Never throws: nullish or malformed network/channel input returns `false`
 * (expanded) instead of crashing sidebar rendering.
 *
 * @param network Network the channel belongs to.
 * @param channel Channel to check.
 * @returns True when the channel should render collapsed.
 */
export default (
	network: ClientNetwork | null | undefined,
	channel: ClientChan | null | undefined
): boolean => {
	try {
		if (!network || !channel) {
			return false;
		}

		if (!network.isCollapsed || channel.highlight || channel.type === ChanType.LOBBY) {
			return false;
		}

		if (store.state.activeChannel && channel === store.state.activeChannel.channel) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
};
