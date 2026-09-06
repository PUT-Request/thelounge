import {store} from "../store";

/**
 * Checks whether the "General" settings tab should be shown.
 *
 * On public (multi-user) instances the general tab is hidden unless file
 * uploads are enabled. Never throws: a missing store or configuration
 * defaults to showing the tab so routing never crashes.
 *
 * @returns True when the General settings tab should be visible.
 */
export function shouldShowGeneralSettings(): boolean {
	try {
		const config = store.state.serverConfiguration;
		return !config?.public || !!config?.fileUpload;
	} catch {
		return true;
	}
}
