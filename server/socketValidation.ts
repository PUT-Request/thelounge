import _ from "lodash";

import type {SearchQuery} from "../shared/types/storage";

export const MAX_SEARCH_TERM_LENGTH = 512;
export const MAX_SEARCH_SCOPE_LENGTH = 512;
export const MAX_SEARCH_OFFSET = 10000;

export function isValidTarget(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isValidSearchQuery(value: unknown): value is SearchQuery {
	if (!_.isPlainObject(value)) {
		return false;
	}

	const query = value as Record<string, unknown>;

	return (
		typeof query.searchTerm === "string" &&
		query.searchTerm.length <= MAX_SEARCH_TERM_LENGTH &&
		typeof query.networkUuid === "string" &&
		query.networkUuid.length > 0 &&
		query.networkUuid.length <= MAX_SEARCH_SCOPE_LENGTH &&
		typeof query.channelName === "string" &&
		query.channelName.length > 0 &&
		query.channelName.length <= MAX_SEARCH_SCOPE_LENGTH &&
		Number.isSafeInteger(query.offset) &&
		(query.offset as number) >= 0 &&
		(query.offset as number) <= MAX_SEARCH_OFFSET
	);
}

export function isValidBooleanTargetChange(
	value: unknown,
	property: "setMutedTo" | "setPinnedTo"
): value is {target: number} & Record<typeof property, boolean> {
	return (
		_.isPlainObject(value) &&
		isValidTarget((value as Record<string, unknown>).target) &&
		typeof (value as Record<string, unknown>)[property] === "boolean"
	);
}

export function isValidInvitationDismiss(
	value: unknown
): value is {target: number; channel: string} {
	if (!_.isPlainObject(value)) {
		return false;
	}

	const data = value as Record<string, unknown>;
	return (
		isValidTarget(data.target) &&
		typeof data.channel === "string" &&
		data.channel.length > 0 &&
		data.channel.length <= 512
	);
}
