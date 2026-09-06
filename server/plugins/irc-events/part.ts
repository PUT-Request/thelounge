import {IrcEventHandler} from "../../client";

import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("part", function (data) {
		if (!data.channel) {
			return;
		}

		const chan = network.getChannel(data.channel);

		if (typeof chan === "undefined") {
			return;
		}

		const user = chan.getUser(data.nick);
		const self = network.casefold(data.nick) === network.casefold(irc.user.nick);
		const msg = new Msg({
			type: MessageType.PART,
			time: data.time,
			text: data.message || "",
			hostmask: data.ident + "@" + data.hostname,
			from: user,
			self,
		});

		// Self parts should not be buffered and need special handling
		if (self) {
			chan.pushMessage(client, msg);
			client.part(network, chan);
			return;
		}

		// User list update callback - executed regardless of buffering
		const updateUserList = () => {
			chan.removeUser(user);
		};

		// Try to process through mass event aggregator
		const wasBuffered = client.massEventAggregator.processMessage(
			network,
			chan,
			msg,
			updateUserList
		);

		if (!wasBuffered) {
			// Not in mass event mode - process normally
			chan.pushMessage(client, msg);
			updateUserList();
		}
	});
};
