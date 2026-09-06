import type {default as Client, IrcEventHandler} from "../../client";
import type Network from "../../models/network";
import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";
import {ChanType, SpecialChanType} from "../../../shared/types/chan";
import type {PendingInvite} from "../../models/network";
import Config from "../../config";
import log from "../../log";

const INVITES_WINDOW_NAME = "Invites";

export function upsertPendingInvite(network: Network, invite: PendingInvite): void {
	const existing = network.pendingInvites.find(
		(entry) => network.casefold(entry.channel) === network.casefold(invite.channel)
	);

	if (existing) {
		existing.from = invite.from;
		existing.time = invite.time;
	} else {
		network.pendingInvites.push(invite);
	}
}

export function removePendingInvite(network: Network, channel: string): boolean {
	const index = network.pendingInvites.findIndex(
		(entry) => network.casefold(entry.channel) === network.casefold(channel)
	);

	if (index === -1) {
		return false;
	}

	network.pendingInvites.splice(index, 1);
	return true;
}

export function findInvitesWindow(network: Network) {
	return network.channels.find(
		(chan) => chan.type === ChanType.SPECIAL && chan.special === SpecialChanType.INVITES
	);
}

// Push the current pending list into the open window, if any.
export function syncInvitesWindow(client: Client, network: Network): void {
	const chan = findInvitesWindow(network);

	if (!chan) {
		return;
	}

	chan.data = [...network.pendingInvites];

	client.emit("msg:special", {
		chan: chan.id,
		data: chan.data,
	});
}

export function openInvitesWindow(client: Client, network: Network) {
	let chan = findInvitesWindow(network);

	if (typeof chan === "undefined") {
		chan = client.createChannel({
			type: ChanType.SPECIAL,
			special: SpecialChanType.INVITES,
			name: INVITES_WINDOW_NAME,
			data: [...network.pendingInvites],
		});
		client.emit("join", {
			network: network.uuid,
			chan: chan.getFilteredClone(true),
			shouldOpen: true,
			index: network.addChannel(chan),
		});
		client.save();
	} else {
		syncInvitesWindow(client, network);
	}
}

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("invite", function (data) {
		let chan = network.getChannel(data.channel);

		if (typeof chan === "undefined") {
			chan = network.getLobby();
		}

		const invitedYou = network.casefold(data.invited) === network.casefold(irc.user.nick);

		const msg = new Msg({
			type: MessageType.INVITE,
			time: data.time,
			from: chan.getUser(data.nick),
			target: chan.getUser(data.invited),
			channel: data.channel,
			highlight: invitedYou,
			invitedYou: invitedYou,
		});
		chan.pushMessage(client, msg);

		if (!invitedYou) {
			return;
		}

		if (!Config.values.public) {
			try {
				client.flushMessageStorage();
			} catch (error: unknown) {
				log.error(
					`Failed to persist invite: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		}

		upsertPendingInvite(network, {
			channel: data.channel,
			from: data.nick,
			time: msg.time.getTime(),
		});
		syncInvitesWindow(client, network);

		// Direct invites are easy to miss in a busy lobby: notify like a mention.
		if (!chan.muted) {
			client.manager.webPush.push(
				client,
				{
					type: "notification",
					chanId: chan.id,
					msgId: msg.id,
					storageId: msg.storageId,
					timestamp: data.time || Date.now(),
					title: data.channel,
					body: `${data.nick} invited you to ${data.channel}`,
				},
				true
			);
		}
	});
};
