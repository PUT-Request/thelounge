import {SharedChan} from "./chan";
import type {IrcCaseMapping} from "../irc";

export type SharedPrefixObject = {
	symbol: string;
	mode: string;
};

export type SharedNetworkChan = SharedChan & {
	totalMessages: number;
};

export type SharedPrefix = {
	prefix: SharedPrefixObject[];
	modeToSymbol: {[mode: string]: string};
	symbols: string[];
};

export type SharedServerOptions = {
	CHANTYPES: string[];
	CASEMAPPING: IrcCaseMapping;
	PREFIX: SharedPrefix;
	NETWORK: string;
	supportsReply: boolean;
	supportsChathistory: boolean;
	MONITOR: number | null;
};

export type SharedNetworkStatus = {
	connected: boolean;
	secure: boolean;
};

export type SharedNetwork = {
	uuid: string;
	name: string;
	nick: string;
	serverOptions: SharedServerOptions;
	status: SharedNetworkStatus;
	channels: SharedNetworkChan[];
};
