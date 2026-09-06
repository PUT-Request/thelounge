import storage from "./localStorage";
import socket from "./socket";
import {config, createState} from "./settings";
import {Store} from "vuex";
import {State} from "./store";

/**
 * Creates the namespaced `settings` Vuex module.
 *
 * State is seeded from validated defaults merged with localStorage, so a
 * corrupt stored payload can never crash store creation. Settings writes are
 * the one place where concurrent `update` dispatches can interleave, which is
 * why persistence serializes the already-committed state snapshot.
 *
 * @param store Root Vuex store the settings module is attached to.
 * @returns Vuex module definition for client settings.
 */
export function createSettingsStore(store: Store<State>) {
	return {
		namespaced: true,
		state: assignStoredSettings(createState(), loadFromLocalStorage()),
		mutations: {
			set(state, {name, value}) {
				state[name] = value;
			},
		},
		actions: {
			syncAll({state}, force = false) {
				if (state.syncSettings === false && force === false) {
					return;
				}

				store.commit("serverHasSettings", true);

				for (const name in state) {
					if (
						Object.hasOwn(config, name) &&
						(config[name].sync !== "never" || config[name].sync === "always")
					) {
						socket.emit("setting:set", {name, value: state[name]});
					}
				}
			},
			applyAll({state}) {
				for (const settingName in config) {
					config[settingName].apply(store, state[settingName], true);
				}
			},
			update({state, commit}, {name, value, sync = false}) {
				if (state[name] === value) {
					return;
				}

				const settingConfig = config[name];

				// Trying to update a non existing setting (e.g. server has an old key)
				if (!settingConfig) {
					return;
				}

				if (
					sync === false &&
					(state.syncSettings === false || settingConfig.sync === "never")
				) {
					return;
				}

				commit("set", {name, value});

				try {
					storage.set("settings", JSON.stringify(state));
				} catch {
					// Storage full or blocked: in-memory state is still updated.
				}

				try {
					settingConfig.apply(store, value);
				} catch {
					// A throwing apply() must not break the settings mutation above.
				}

				if (!sync) {
					return;
				}

				if (
					(state.syncSettings && settingConfig.sync !== "never") ||
					settingConfig.sync === "always"
				) {
					socket.emit("setting:set", {name, value});
				}
			},
		},
	};
}

/**
 * Loads stored settings from localStorage.
 *
 * Never throws and never returns a non-object: corrupt JSON resets the key
 * and yields `{}`, and the legacy array-form `highlights` value is joined
 * back to a string (guarded so a malformed value cannot throw).
 *
 * @returns Stored settings object, or `{}` when absent or invalid.
 */
function loadFromLocalStorage(): Record<string, any> {
	let storedSettings: Record<string, any> = {};

	try {
		storedSettings = JSON.parse(storage.get("settings") || "{}");
	} catch (e) {
		try {
			storage.remove("settings");
		} catch {
			// Storage blocked: nothing to clean up.
		}

		return {};
	}

	if (!storedSettings || typeof storedSettings !== "object" || Array.isArray(storedSettings)) {
		return {};
	}

	// Older The Lounge versions converted highlights to an array, turn it back into a string
	try {
		if (storedSettings.highlights !== null && typeof storedSettings.highlights === "object") {
			storedSettings.highlights = (storedSettings.highlights as unknown[]).join(", ");
		}
	} catch {
		delete storedSettings.highlights;
	}

	return storedSettings;
}

/**
 * Essentially Object.assign but does not overwrite and only assigns
 * if key exists in both supplied objects and types match
 *
 * @param {object} defaultSettings
 * @param {object} storedSettings
 */
function assignStoredSettings(
	defaultSettings: Record<string, any>,
	storedSettings: Record<string, any>
) {
	const newSettings = {...defaultSettings};

	if (!storedSettings || typeof storedSettings !== "object") {
		return newSettings;
	}

	for (const key in defaultSettings) {
		// Make sure the setting in local storage has the same type that the code expects
		if (
			typeof storedSettings[key] !== "undefined" &&
			typeof defaultSettings[key] === typeof storedSettings[key]
		) {
			newSettings[key] = storedSettings[key];
		}
	}

	return newSettings;
}
