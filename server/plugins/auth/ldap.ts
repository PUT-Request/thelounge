import {Client, SearchOptions} from "ldapts";
import colors from "chalk";

import log from "../../log";
import Config from "../../config";
import type {AuthHandler} from "../auth";

// Escape LDAP filter assertion values per RFC 4515 section 3:
// https://datatracker.ietf.org/doc/html/rfc4515#section-3
export function escapeLdapFilter(value: string): string {
	return value.replace(/[\\*()\0]/g, (c) => {
		return "\\" + c.charCodeAt(0).toString(16).padStart(2, "0");
	});
}

function createClient(): Client {
	const config = Config.values;

	return new Client({
		url: config.ldap.url,
		tlsOptions: config.ldap.tlsOptions,
	});
}

async function ldapBind(bindDN: string, password: string): Promise<boolean> {
	const client = createClient();

	try {
		await client.bind(bindDN, password);
		return true;
	} catch (err) {
		log.error("LDAP bind failed:", String(err));
		return false;
	} finally {
		await client.unbind().catch(() => undefined);
	}
}

function simpleLdapAuth(user: string, password: string, callback: (success: boolean) => void) {
	if (!user || !password) {
		return callback(false);
	}

	const config = Config.values;

	const userDN = user.replace(/([,\\/#+<>;"= ])/g, "\\$1");
	const bindDN = `${config.ldap.primaryKey}=${userDN},${config.ldap.baseDN || ""}`;

	log.info(`Auth against LDAP ${config.ldap.url} with provided bindDN ${bindDN}`);

	ldapBind(bindDN, password).then(callback, () => callback(false));
}

/**
 * LDAP auth using initial DN search (see config comment for ldap.searchDN)
 */
function advancedLdapAuth(user: string, password: string, callback: (success: boolean) => void) {
	if (!user || !password) {
		return callback(false);
	}

	advancedLdapFlow(user, password).then(callback, () => callback(false));
}

async function advancedLdapFlow(user: string, password: string): Promise<boolean> {
	const config = Config.values;
	const userDN = user.replace(/([,\\/#+<>;"= ])/g, "\\$1");
	const userFilterValue = escapeLdapFilter(user);

	const client = createClient();

	try {
		try {
			await client.bind(config.ldap.searchDN.rootDN, config.ldap.searchDN.rootPassword);
		} catch {
			log.error("Invalid LDAP root credentials");
			return false;
		}

		const base = config.ldap.searchDN.base;
		const searchOptions: SearchOptions = {
			scope: config.ldap.searchDN.scope,
			filter: `(&(${config.ldap.primaryKey}=${userFilterValue})${config.ldap.searchDN.filter})`,
			attributes: ["dn"],
		};

		let entries;

		try {
			({searchEntries: entries} = await client.search(base, searchOptions));
		} catch {
			log.warn(`LDAP User not found: ${userDN}`);
			return false;
		}

		const entry = entries[0];

		if (!entry) {
			log.warn(`LDAP Search did not find anything for: ${userDN}`);
			return false;
		}

		const bindDN = entry.dn;
		log.info(`Auth against LDAP ${config.ldap.url} with found bindDN ${bindDN || ""}`);

		return await ldapBind(bindDN, password);
	} finally {
		await client.unbind().catch(() => undefined);
	}
}

const ldapAuth: AuthHandler = (manager, client, user, password, callback) => {
	// TODO: Enable the use of starttls() as an alternative to ldaps

	// TODO: move this out of here and get rid of `manager` and `client` in
	// auth plugin API
	function callbackWrapper(valid: boolean) {
		if (valid && !client) {
			manager.addUser(user, null, true);
		}

		callback(valid);
	}

	let auth: typeof simpleLdapAuth | typeof advancedLdapAuth;

	if ("baseDN" in Config.values.ldap) {
		auth = simpleLdapAuth;
	} else {
		auth = advancedLdapAuth;
	}

	return auth(user, password, callbackWrapper);
};

/**
 * Use the LDAP filter from config to check that users still exist before loading them
 * via the supplied callback function.
 */

function advancedLdapLoadUsers(users: string[], callbackLoadUser) {
	const config = Config.values;

	const load = async () => {
		const ldapclient = createClient();
		const base = config.ldap.searchDN.base;

		try {
			try {
				await ldapclient.bind(
					config.ldap.searchDN.rootDN,
					config.ldap.searchDN.rootPassword
				);
			} catch {
				log.error("Invalid LDAP root credentials");
				return;
			}

			const remainingUsers = new Set(users);

			const searchOptions: SearchOptions = {
				scope: config.ldap.searchDN.scope,
				filter: `${config.ldap.searchDN.filter}`,
				attributes: [config.ldap.primaryKey],
				paged: true,
			};

			let entries;

			try {
				({searchEntries: entries} = await ldapclient.search(base, searchOptions));
			} catch (err) {
				log.error(`LDAP search error: ${err?.toString()}`);
				return;
			}

			for (const entry of entries) {
				const user = entryAttributeToString(entry[config.ldap.primaryKey]);

				if (user !== null && remainingUsers.has(user)) {
					remainingUsers.delete(user);
					callbackLoadUser(user);
				}
			}

			remainingUsers.forEach((user) => {
				log.warn(
					`No account info in LDAP for ${colors.bold(user)} but user config file exists`
				);
			});
		} finally {
			await ldapclient.unbind().catch(() => undefined);
		}
	};

	// The Auth plugin API is synchronous (boolean), while ldapts is
	// promise-only: kick the load off in the background like the old
	// event-driven code did, and report the LDAP path as claimed.
	void load();

	return true;
}

function entryAttributeToString(
	value: Buffer | Buffer[] | string[] | string | undefined
): string | null {
	if (value === undefined) {
		return null;
	}

	const first = Array.isArray(value) ? value[0] : value;

	if (first === undefined) {
		return null;
	}

	return typeof first === "string" ? first : first.toString();
}

function ldapLoadUsers(users: string[], callbackLoadUser) {
	if ("baseDN" in Config.values.ldap) {
		// simple LDAP case can't test for user existence without access to the
		// user's unhashed password, so indicate need to fallback to default
		// loadUser behaviour by returning false
		return false;
	}

	return advancedLdapLoadUsers(users, callbackLoadUser);
}

function isLdapEnabled() {
	return !Config.values.public && Config.values.ldap.enable;
}

export default {
	moduleName: "ldap",
	auth: ldapAuth,
	isEnabled: isLdapEnabled,
	loadUsers: ldapLoadUsers,
};
