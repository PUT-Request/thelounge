export type SharedUser = {
	modes: string[];
	// Users in the channel have only one mode assigned
	mode: string;
	away: string;
	nick: string;
	lastMessage: number;
	isBot: boolean;
	// Services account name (IRCv3 account-tag / extended-join / account-notify)
	account?: string;
	// user@host parts (IRCv3 userhost-in-names, WHO, extended-join)
	ident?: string;
	hostname?: string;
};
