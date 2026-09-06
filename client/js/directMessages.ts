type Identified = {id: number};

export function parseCollapsedDirectMessages(value: string | null): Set<string> {
	try {
		const parsed = JSON.parse(value || "[]");
		return new Set<string>(
			Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
		);
	} catch {
		return new Set<string>();
	}
}

export function reorderDirectMessages(
	allChannels: Identified[],
	queries: Identified[],
	visibleQueries: Identified[],
	oldIndex: number,
	newIndex: number
): number[] | null {
	const reordered = [...visibleQueries];

	if (
		oldIndex < 0 ||
		newIndex < 0 ||
		oldIndex >= reordered.length ||
		newIndex >= reordered.length
	) {
		return null;
	}

	const [moved] = reordered.splice(oldIndex, 1);

	if (!moved) {
		return null;
	}

	reordered.splice(newIndex, 0, moved);
	const queryIds = new Set(queries.map(({id}) => id));
	const visibleIds = new Set(reordered.map(({id}) => id));
	const replacement = reordered.map(({id}) => id);
	const queryOrder = allChannels
		.filter(({id}) => queryIds.has(id))
		.map(({id}) => (visibleIds.has(id) ? replacement.shift()! : id));
	let queryIndex = 0;

	return allChannels.map(({id}) => (queryIds.has(id) ? queryOrder[queryIndex++] : id));
}
