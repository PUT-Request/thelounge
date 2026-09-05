import {PluginInputHandler} from "./index";
import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";
import {ChanType} from "../../../shared/types/chan";
import {openInvitesWindow} from "../irc-events/invite";

const commands = ["invite", "invitelist", "invites"];

const input: PluginInputHandler = function ({irc}, chan, cmd, args) {
	if (cmd === "invites") {
		const target = this.find(chan.id);

		if (target) {
			openInvitesWindow(this, target.network);
		}

		return;
	}

	if (cmd === "invitelist") {
		irc.inviteList(chan.name);
		return;
	}

	if (args.length === 2) {
		irc.raw("INVITE", args[0], args[1]); // Channel provided in the command
	} else if (args.length === 1 && chan.type === ChanType.CHANNEL) {
		irc.raw("INVITE", args[0], chan.name); // Current channel
	} else {
		chan.pushMessage(
			this,
			new Msg({
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels or by specifying a target.`,
			})
		);
	}
};

export default {
	commands,
	input,
};
