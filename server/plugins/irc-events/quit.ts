import {IrcEventHandler} from "../../client";

import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("quit", function (data) {
		network.channels.forEach((chan) => {
			const user = chan.findUser(data.nick);

			if (typeof user === "undefined") {
				return;
			}

			const msg = new Msg({
				time: data.time,
				type: MessageType.QUIT,
				text: data.message || "",
				hostmask: data.ident + "@" + data.hostname,
				from: user,
			});

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

		// If user with the nick we are trying to keep has quit, try to get this nick
		if (network.keepNick === data.nick) {
			irc.changeNick(network.keepNick);
			network.keepNick = null;
		}
	});
};
