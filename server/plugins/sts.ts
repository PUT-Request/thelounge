import _ from "lodash";
import fs from "fs";
import path from "path";
import log from "../log";
import Config from "../config";

type PolicyOption = {
	port: number;
	duration: number;
	expires: number;
	host: string;
};

type PolicyMap = Map<string, Omit<PolicyOption, "host">>;

class STSPolicies {
	stsFile: string;
	refresh: _.DebouncedFunc<any>;

	private policies: PolicyMap;

	constructor() {
		this.stsFile = path.join(Config.getHomePath(), "sts-policies.json");
		this.policies = new Map();
		// eslint-disable-next-line @typescript-eslint/unbound-method
		this.refresh = _.debounce(this.saveFile, 10000, {maxWait: 60000});

		if (!fs.existsSync(this.stsFile)) {
			return;
		}

		let storedPolicies: PolicyOption[];

		try {
			storedPolicies = JSON.parse(fs.readFileSync(this.stsFile, "utf-8")) as PolicyOption[];
		} catch (e: any) {
			log.error(`Failed to read STS policies file: ${String(e)}`);
			return;
		}

		if (!Array.isArray(storedPolicies)) {
			log.error("Failed to read STS policies file: expected an array");
			return;
		}

		const now = Date.now();

		storedPolicies.forEach((value) => {
			if (value.expires > now) {
				this.policies.set(value.host, {
					port: value.port,
					duration: value.duration,
					expires: value.expires,
				});
			}
		});
	}

	/**
	 * Returns the cached STS policy for a host, or null when absent/expired.
	 *
	 * @param host Hostname to look up.
	 * @returns The policy, or null if none applies.
	 */
	get(host: string) {
		const policy = this.policies.get(host);

		if (typeof policy === "undefined") {
			return null;
		}

		if (policy.expires <= Date.now()) {
			this.policies.delete(host);
			this.refresh();
			return null;
		}

		return policy;
	}

	/**
	 * Inserts or removes the STS policy for a host and schedules a save.
	 *
	 * @param host Hostname the policy applies to.
	 * @param port Port the policy applies to.
	 * @param duration Max-age in seconds (<=0 removes the policy).
	 */
	update(host: string, port: number, duration: number) {
		if (duration > 0) {
			this.policies.set(host, {
				port: port,
				duration: duration,
				expires: Date.now() + duration * 1000,
			});
		} else {
			this.policies.delete(host);
		}

		this.refresh();
	}

	/**
	 * Extends an existing policy's expiry from its original duration.
	 *
	 * @param host Hostname whose expiry should be refreshed.
	 * @returns The policy, or null when absent.
	 */
	refreshExpiration(host: string) {
		const policy = this.policies.get(host);

		if (typeof policy === "undefined") {
			return null;
		}

		policy.expires = Date.now() + policy.duration * 1000;
	}

	/**
	 * Persists cached STS policies to disk (debounced via refresh).
	 */
	saveFile() {
		const policiesToStore: PolicyOption[] = [];

		this.policies.forEach((value, key) => {
			policiesToStore.push({
				host: key,
				port: value.port,
				duration: value.duration,
				expires: value.expires,
			});
		});

		const file = JSON.stringify(policiesToStore, null, "\t");

		fs.writeFile(this.stsFile, file, {flag: "w+"}, (err) => {
			if (err) {
				log.error("Failed to update STS policies file!", err.message);
			}
		});
	}
}

export default new STSPolicies();
