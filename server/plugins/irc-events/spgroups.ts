import type {IrcEventHandler} from "../../client";
import log from "../../log";
import {UserGroup} from "../../../shared/types/chan";

export default <IrcEventHandler>function (irc, network) {
	// Handle SPGROUPS command from seedpool/enhanced capable servers
	// Format: :SeedServ SPGROUPS #channel :{"groups":[{"name":"Sysop","users":["admin1"]}, ...]}
	irc.on("unknown command", (command) => {
		if (command.command !== "SPGROUPS") {
			return;
		}

		const channelName = command.params[0];
		const jsonPayload = command.params[1];

		if (!channelName || !jsonPayload || jsonPayload.length > 256 * 1024) {
			log.warn("SPGROUPS: Missing channel or payload");
			return;
		}

		const chan = network.getChannel(channelName);

		if (!chan) {
			log.warn(`SPGROUPS: Channel ${channelName} not found`);
			return;
		}

		try {
			const data = JSON.parse(jsonPayload) as {groups: UserGroup[]};

			if (
				!data.groups ||
				!Array.isArray(data.groups) ||
				data.groups.length > 100 ||
				data.groups.reduce((total, group) => total + (group?.users?.length ?? 0), 0) >
					5000 ||
				!data.groups.every(
					(group) =>
						group &&
						typeof group.name === "string" &&
						group.name.length > 0 &&
						group.name.length <= 100 &&
						Number.isSafeInteger(group.position) &&
						Array.isArray(group.users) &&
						group.users.length <= 1000 &&
						group.users.every(
							(user) =>
								typeof user === "string" && user.length > 0 && user.length <= 512
						)
				)
			) {
				log.warn("SPGROUPS: Invalid payload format, expected {groups: [...]}");
				return;
			}

			// Store groups on the channel, sorted by position (highest first)
			const names = new Set<string>();
			chan.groups = data.groups
				.filter((group) => {
					const key = group.name.toLowerCase();

					if (names.has(key)) {
						return false;
					}

					names.add(key);
					return true;
				})
				.map((group) => {
					const users = new Set<string>();
					return {
						...group,
						users: group.users.filter((user) => {
							const key = network.casefold(user);

							if (users.has(key)) {
								return false;
							}

							users.add(key);
							return true;
						}),
					};
				})
				.sort((a, b) => b.position - a.position);

			// Emit to client
			this.emit("channel:groups", {
				chan: chan.id,
				groups: chan.groups,
			});
		} catch (err) {
			log.error(`SPGROUPS: Failed to parse JSON payload: ${String(err)}`);
		}
	});
};
