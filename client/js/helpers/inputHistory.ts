import {MessageType, SharedMsg} from "../../../shared/types/msg";

/**
 * Extracts the current user's past message texts for input-history recall.
 *
 * Never throws: non-array input yields an empty list, and a non-positive or
 * non-finite limit yields an empty list instead of an unbounded slice.
 *
 * @param messages Messages to scan (most recent last).
 * @param limit Maximum number of entries to return.
 * @returns Past message texts, most recent first, capped at `limit`.
 */
export function extractInputHistory(messages: SharedMsg[], limit: number): string[] {
	if (!Array.isArray(messages) || !Number.isFinite(limit) || limit <= 0) {
		return [];
	}

	return (
		messages
			.filter((m) => m.self && m.text && m.type === MessageType.MESSAGE)
			// TS is too stupid to see the guard in .filter(), so we monkey patch it
			// to please the compiler
			.map((m) => m.text!)
			.reverse()
			.slice(0, limit)
	);
}
