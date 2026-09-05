type KeybindEvent = (MouseEvent | Mousetrap.ExtendedKeyboardEvent) & {
	target?: EventTarget | null;
};

/**
 * Checks whether a keybind should be ignored because the user is typing.
 *
 * Never throws: events without a usable target are treated as "not ignored"
 * so global shortcuts keep working instead of crashing the handler.
 *
 * @param event Key or mouse event carrying the focused element as `target`.
 * @returns True when focus is in a non-empty text input and the keybind
 * should be skipped.
 */
export default (event: MouseEvent | Mousetrap.ExtendedKeyboardEvent): boolean => {
	try {
		const target = (event as KeybindEvent | null | undefined)?.target as HTMLElement | null;

		if (!target || typeof target.tagName !== "string") {
			return false;
		}

		if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
			return false;
		}

		// If focus is in a textarea, do not handle keybinds if user has typed anything
		// This is done to prevent keyboard layout binds conflicting with ours
		// For example alt+shift+left on macos selects a word
		return !!(target as HTMLInputElement).value;
	} catch {
		return false;
	}
};
