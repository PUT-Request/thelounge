import {IrcEventHandler} from "../../client";
import Helper from "../../helper";
import {ChanType} from "../../../shared/types/chan";
import {VALID_TYPING_STATUSES, TypingStatus} from "../../../shared/types/typing";

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("tagmsg", function (data) {
		if (network.casefold(data.nick) === network.casefold(irc.user.nick)) {
			return;
		}

		// Typing states from CHATHISTORY playback describe the past,
		// flashing them now would be wrong.
		if (data.batch?.type === "chathistory") {
			return;
		}

		const shouldIgnore = network.ignoreList.some(function (entry) {
			return Helper.compareHostmask(entry, data);
		});

		if (shouldIgnore) {
			return;
		}

		let target = data.target;

		if (network.casefold(target) === network.casefold(irc.user.nick)) {
			target = data.nick;
		}

		const chan = network.getChannel(target);

		if (!chan) {
			return;
		}

		if (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) {
			return;
		}

		// https://ircv3.net/specs/client-tags/typing
		const typing = data.tags["+typing"];

		if (typing && VALID_TYPING_STATUSES.has(typing as TypingStatus)) {
			client.emit("typing", {
				network: network.uuid,
				chan: chan.id,
				nick: data.nick,
				status: typing as TypingStatus,
			});
		}
	});
};
