import {PluginInputHandler} from "./index";
import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";
import {ChanType} from "../../../shared/types/chan";

const commands = ["rainbow", "rgb"];

export function rainbow(text: string) {
	const skipChars = [" ", "\x03", "\x02", "\x1F", "\x1D", "\x0F", "\x1e", "\x11"];
	const colorCodes = [4, 7, 8, 9, 3, 10, 11, 12, 2, 6, 13];
	const colors = colorCodes.length;
	const graphemes = Array.from(
		new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(text),
		({segment}) => segment
	);

	return graphemes
		.map((char, index) => {
			if (skipChars.includes(char)) {
				return char;
			}

			const isNumber = Number.isInteger(Number(char));
			const currentColor = String(colorCodes[((index % colors) + colors) % colors]).padStart(
				isNumber ? 2 : 1,
				"0"
			);

			return `\x03${currentColor}${char}`;
		})
		.join("");
}

const input: PluginInputHandler = function ({irc}, chan, cmd, args) {
	if (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY) {
		chan.pushMessage(
			this,
			new Msg({
				type: MessageType.ERROR,
				text: `${cmd} command can only be used in channels and queries.`,
			})
		);

		return;
	}

	let text;

	switch (cmd) {
		case "rgb":
		case "rainbow":
			if (args.length === 0) {
				break;
			}

			text = rainbow(text || args.join(" "));
			irc.say(chan.name, text);

			// If the IRCd does not support echo-message, simulate the message
			// being sent back to us.
			if (!irc.network.cap.isEnabled("echo-message")) {
				irc.emit("privmsg", {
					nick: irc.user.nick,
					ident: irc.user.username,
					hostname: irc.user.host,
					target: chan.name,
					message: text,
				});
			}

			break;
	}

	return true;
};

export default {
	commands,
	input,
};
