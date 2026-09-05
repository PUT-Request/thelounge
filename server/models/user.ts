import _ from "lodash";
import Prefix from "./prefix";

class User {
	modes!: string[];
	// Users in the channel have only one mode assigned
	mode!: string;
	away!: string;
	nick!: string;
	lastMessage!: number;
	isBot!: boolean;
	// Services account name (IRCv3 account-tag / extended-join / account-notify)
	account?: string;
	// user@host parts (IRCv3 userhost-in-names, WHO, extended-join)
	ident?: string;
	hostname?: string;

	constructor(attr: Partial<User>, prefix?: Prefix) {
		_.defaults(this, attr, {
			modes: [],
			away: "",
			nick: "",
			lastMessage: 0,
			isBot: false,
		});

		Object.defineProperty(this, "mode", {
			get() {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return this.modes[0] || "";
			},
		});

		this.setModes(this.modes, prefix || new Prefix([]));
	}

	setModes(modes: string[], prefix: Prefix) {
		// irc-framework sets character mode, but The Lounge works with symbols
		this.modes = modes.map((mode) => prefix.modeToSymbol[mode]);
	}

	toJSON() {
		return {
			nick: this.nick,
			modes: this.modes,
			away: this.away,
			lastMessage: this.lastMessage,
			isBot: this.isBot,
			account: this.account,
			ident: this.ident,
			hostname: this.hostname,
		};
	}
}

export default User;
