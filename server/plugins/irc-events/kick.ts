import {IrcEventHandler} from "../../client";

import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";
import {ChanState} from "../../../shared/types/chan";

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("kick", function (data) {
		const chan = network.getChannel(data.channel!);

		if (typeof chan === "undefined") {
			return;
		}

		const user = chan.getUser(data.kicked!);
		const kickedSelf = network.casefold(data.kicked!) === network.casefold(irc.user.nick);
		const msg = new Msg({
			type: MessageType.KICK,
			time: data.time,
			from: chan.getUser(data.nick),
			target: user,
			text: data.message || "",
			highlight: kickedSelf,
			self: network.casefold(data.nick) === network.casefold(irc.user.nick),
		});

		// Self kicks should not be buffered and need special handling
		if (kickedSelf) {
			chan.pushMessage(client, msg);
			chan.users = new Map();
			chan.state = ChanState.PARTED;

			client.emit("channel:state", {
				chan: chan.id,
				state: chan.state,
			});
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
