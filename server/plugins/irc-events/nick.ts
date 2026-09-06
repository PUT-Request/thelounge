import {IrcEventHandler} from "../../client";

import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";
import {ChanType} from "../../../shared/types/chan";

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("nick", function (data) {
		const self = network.casefold(data.nick) === network.casefold(irc.user.nick);

		if (self) {
			network.setNick(data.new_nick);

			const lobby = network.getLobby();
			const msg = new Msg({
				text: `You're now known as ${data.new_nick}`,
			});
			lobby.pushMessage(client, msg, true);

			client.save();
			client.emit("nick", {
				network: network.uuid,
				nick: data.new_nick,
			});
		}

		network.channels.forEach((chan) => {
			const user = chan.findUser(data.nick);

			if (typeof user === "undefined") {
				// Update monitor list for query channels that match the old nick
				if (
					chan.type === ChanType.QUERY &&
					network.casefold(chan.name) === network.casefold(data.nick)
				) {
					network.renameMonitor(chan.name, data.new_nick);
					chan.name = data.new_nick;

					const nickMsg = new Msg({
						time: data.time,
						from: chan.getUser(data.nick),
						type: MessageType.NICK,
						new_nick: data.new_nick,
					});
					chan.pushMessage(client, nickMsg);

					client.emit("channel:rename", {
						chan: chan.id,
						name: data.new_nick,
					});

					client.save();
				}

				return;
			}

			const msg = new Msg({
				time: data.time,
				from: user,
				type: MessageType.NICK,
				new_nick: data.new_nick,
			});

			// User list update callback - executed regardless of buffering
			const updateUserList = () => {
				chan.removeUser(user);
				user.nick = data.new_nick;
				chan.setUser(user);

				client.emit("users", {
					chan: chan.id,
				});
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
	});
};
