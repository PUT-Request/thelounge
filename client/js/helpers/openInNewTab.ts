/**
 * Opens a URL in a new tab via a synthetic anchor click.
 *
 * Validates the URL first and no-ops on invalid, empty, or disallowed schemes
 * (only `http:`, `https:`, and `mailto:` are opened), so untrusted input can
 * never trigger `javascript:` navigation or throw inside click handlers.
 *
 * @param href URL to open.
 */
export function openInNewTab(href: string) {
	try {
		if (typeof href !== "string" || href.trim().length === 0) {
			return;
		}

		const parsed = new URL(href, window.location.origin);

		if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
			return;
		}

		Object.assign(document.createElement("a"), {
			target: "_blank",
			rel: "noopener noreferrer",
			href: parsed.toString(),
		}).click();
	} catch {
		// Invalid URL: do nothing instead of throwing inside UI handlers.
	}
}
