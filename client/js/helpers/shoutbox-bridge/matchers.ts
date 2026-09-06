import {type Matcher} from "./types/matcher";

/**
 * Ordered shoutbox bridge matchers (basic nick-list matchers plus
 * advanced predicate matchers). First match wins in `parser()`.
 *
 * Each `transform` is total: non-string input yields `undefined` (no match)
 * instead of throwing, and shared-regex `lastIndex` is reset per call so
 * sequential parses cannot leak state.
 */
export const matchers: Matcher[] = [
	{
		type: "basic",
		name: "Aither",
		description: "[nick] message",
		matches: ["chatbot"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "Anthelion",
		description: "[ SB ] (nick): message",
		matches: ["sauron"],
		regex: /^0 \[2 SB0 \] \((?<nick>[^):]+)\): (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "Aura4K",
		description: "[nick] message",
		matches: ["aurarelay"],
		regex: /^11\[04(?<nick>[^:\]]+?)11\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "BeyondHD",
		description: "[SB] nick: message",
		matches: ["willie"],
		regex: /^09\[SB\] (?<nick>[^:]+): (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "DarkPeers",
		description: "[nick] message",
		matches: ["darkpeers", "dp"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "DesiTorrents",
		description: "[Web] nick: message",
		matches: ["subedaar"],
		regex: /^\[Web\] (?<nick>[^:]+): (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "DigitalCore",
		description: "<nick> message",
		matches: ["endor"],
		regex: /^<(?<nick>[^>]+?)> (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "DreadVault",
		description: "<nick> message",
		matches: ["dreadvaultbot"],
		regex: /^<(?<nick>[^>]+?)> (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "HomiesHelpDesk",
		description: "[username] (platform): message",
		matches: ["bbot"],
		regex: /^\[(?<nick>[^\]]+)\] \([^)]+\): (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "HUNO (Discord)",
		description: "»<nick> (<rank>)« <message> | »<nick>« <message>",
		matches: ["mellos"],
		regex: /^»(?<nick>[^«]+?)(?: (?:\p{RGI_Emoji}+|\(.+?\)))?« (?<content>.*)/v,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "advanced",
		name: "HUNO (Web)",
		description: "Nicks in the format '<nick>-web'",
		matches(nick: string) {
			return typeof nick === "string" && nick.endsWith("-web");
		},
		transform(message) {
			const nick = message?.from?.nick;
			const content = message?.text;

			if (typeof nick !== "string" || typeof content !== "string") {
				return undefined;
			}

			return {
				nick: nick.slice(0, -4),
				content,
			};
		},
	},
	{
		type: "basic",
		name: "LST",
		description: "[nick] message",
		matches: ["bot"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "Luminarr",
		description: "[nick] message",
		matches: ["luminarr"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "MidnightScene",
		description: "[nick]: message",
		matches: ["msbridge"],
		regex: /^\[(?<nick>[^:\]]+)\]: (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "OnlyEncodes+",
		description: "[nick] message",
		matches: ["bridgebot"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "ReelFliX",
		description: "[Chatbox] nick: message",
		matches: ["wall-e"],
		regex: /^04\[Chatbox\] (?<nick>[^:]+): (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "SkipTheCommercial",
		description: "<nick> message",
		matches: ["stc-shout"],
		regex: /^<(?<nick>[^>]+?)> (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "RocketHD",
		description: "🛰️nick: message",
		matches: ["GLaDOS"],
		regex: /^🛰️(?<nick>[^:]+?): (?<content>.*)/v,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "UploadCX",
		description: "[nick]: message",
		matches: ["ulcx"],
		regex: /^\[(?<nick>[^:\]]+)\]: (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "YUSCENE",
		description: "[nick] message",
		matches: ["yus"],
		regex: /^\[(?<nick>[^:\]]+)\] (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
	{
		type: "basic",
		name: "Zenith",
		description: "[nick]: message",
		matches: ["zenith"],
		regex: /^\[(?<nick>[^:\]]+)\]: (?<content>.*)/,
		transform(message) {
			const text = typeof message?.text === "string" ? message.text : "";

			if (!text) {
				return undefined;
			}

			try {
				// Reset stateful regex cursor so consecutive matches cannot leak
				// `lastIndex` into each other.
				this.regex.lastIndex = 0;
				return typedGroups(text.match(this.regex));
			} catch {
				return undefined;
			}
		},
	},
];

/**
 * Extracts named capture groups (`nick`, `content`) from a regex match.
 *
 * Never throws: a non-match (`null`) yields `undefined` instead of raising,
 * so non-bridged lines fall through to the original message.
 *
 * @param regexMatch Result of `String.match` against a matcher regex.
 * @returns The `nick`/`content` groups, or `undefined` when no match.
 */
function typedGroups<T = RegExpMatchArray["groups"]>(regexMatch: RegExpMatchArray | null) {
	return regexMatch?.groups as T;
}
