/**
 * Copies multi-element chat selections via a temporary off-screen container.
 *
 * No-ops (never throws) when there is no selection, the selection is
 * single-node, or the DOM is unavailable, so copy handlers cannot crash chat
 * rendering. The temporary node is always removed on a timer, and removal is
 * guarded so a concurrent DOM change cannot throw inside the timeout.
 *
 * @param chat Chat container the temporary copy node is attached to.
 */
export default function (chat: HTMLDivElement) {
	try {
		// Disable in Firefox as it already copies flex text correctly
		// @ts-expect-error Property 'InstallTrigger' does not exist on type 'Window & typeof globalThis'.ts(2339)
		if (typeof window.InstallTrigger !== "undefined") {
			return;
		}

		const selection = window.getSelection();

		if (!selection || selection.rangeCount === 0) {
			return;
		}

		// If selection does not span multiple elements, do nothing
		if (selection.anchorNode === selection.focusNode) {
			return;
		}

		const range = selection.getRangeAt(0);
		const documentFragment = range.cloneContents();
		const div = document.createElement("div");

		div.id = "js-copy-hack";
		div.appendChild(documentFragment);
		chat.appendChild(div);

		selection.selectAllChildren(div);

		window.setTimeout(() => {
			try {
				if (div.parentNode === chat) {
					chat.removeChild(div);
				}

				selection.removeAllRanges();
				selection.addRange(range);
			} catch {
				// Chat was unmounted mid-copy: nothing left to restore.
			}
		}, 0);
	} catch {
		// Clipboard APIs may throw in restricted contexts: ignore and keep chat usable.
	}
}
