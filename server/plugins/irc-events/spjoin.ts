import type {IrcEventHandler} from "../../client";
import log from "../../log";
import {ircCasefold} from "../../../shared/irc";

export default <IrcEventHandler>function (irc, network) {
	// Handle SPJOIN command from seedpool/enhanced capable servers
	// Format: :SeedServ SPJOIN #channel nickname :GroupName
	irc.on("unknown command", (command) => {
		if (command.command !== "SPJOIN") {
			return;
		}

		const channelName = command.params[0];
		const nickname = command.params[1];
		const groupName = command.params[2];

		if (
			!channelName ||
			!nickname ||
			!groupName ||
			channelName.length > 512 ||
			nickname.length > 512 ||
			groupName.length > 100
		) {
			log.warn("SPJOIN: Missing channel, nickname, or group");
			return;
		}

		const chan = network.getChannel(channelName);

		if (!chan) {
			log.warn(`SPJOIN: Channel ${channelName} not found`);
			return;
		}

		if (!chan.groups) {
			chan.groups = [];
		}

		// Remove user from any existing group (in case of group change)
		const foldedNick = ircCasefold(nickname, chan.caseMapping);

		for (const group of chan.groups) {
			const foldedUsers = group.users.map((user) => ircCasefold(user, chan.caseMapping));
			const userIndex = foldedUsers.indexOf(foldedNick);

			if (userIndex !== -1) {
				group.users.splice(userIndex, 1);
			}
		}

		// Find the target group or create it
		let targetGroup = chan.groups.find((g) => g.name === groupName);

		if (!targetGroup) {
			if (chan.groups.length >= 100) {
				log.warn(`SPJOIN: Refusing to add more groups for ${channelName}`);
				return;
			}

			// Find the lowest existing position and go below it
			const lowestPosition =
				chan.groups.length > 0 ? Math.min(...chan.groups.map((g) => g.position)) - 1 : 0;
			targetGroup = {name: groupName, position: lowestPosition, users: []};
			chan.groups.push(targetGroup);
		}

		// Add user to the group
		if (
			targetGroup.users.length < 5000 &&
			!targetGroup.users
				.map((user) => ircCasefold(user, chan.caseMapping))
				.includes(foldedNick)
		) {
			targetGroup.users.push(nickname);
		}

		// Sort groups by position (highest first) before emitting
		chan.groups.sort((a, b) => b.position - a.position);

		// Emit updated groups to client
		this.emit("channel:groups", {
			chan: chan.id,
			groups: chan.groups,
		});
	});
};
