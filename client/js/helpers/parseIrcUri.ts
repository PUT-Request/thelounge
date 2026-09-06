export type ParsedIrcUri = {
	name: string;
	host: string;
	port: string;
	join: string;
	tls: boolean;
};

const EMPTY_URI: ParsedIrcUri = {
	name: "",
	host: "",
	port: "",
	join: "",
	tls: false,
};

/**
 * Parses an `irc://` or `ircs://` URI into connection details.
 *
 * Never throws: non-string input or unparsable URIs return an empty-shaped
 * result instead of crashing the connect form.
 *
 * @param stringUri Raw URI typed by the user (e.g. `irc://host:6667/#chan`).
 * @returns Parsed host/port/join/tls fields. Returns `undefined` for a
 * non-IRC scheme and `{}` when the URI has no hostname.
 */
export default (stringUri: string): ParsedIrcUri | Record<string, never> | undefined => {
	const data: ParsedIrcUri = {...EMPTY_URI};

	if (typeof stringUri !== "string" || stringUri.length === 0) {
		return data;
	}

	try {
		// https://tools.ietf.org/html/draft-butcher-irc-url-04
		const uri = new URL(stringUri);

		// Replace protocol with a "special protocol" (that's what it's called in WHATWG spec)
		// So that the uri can be properly parsed
		if (uri.protocol === "irc:") {
			uri.protocol = "http:";

			if (!uri.port) {
				uri.port = "6667";
			}
		} else if (uri.protocol === "ircs:") {
			uri.protocol = "https:";

			if (!uri.port) {
				uri.port = "6697";
			}

			data.tls = true;
		} else {
			return;
		}

		if (!uri.hostname) {
			return {};
		}

		data.host = data.name = uri.hostname;
		data.port = uri.port;

		let channel = "";

		if (uri.pathname.length > 1) {
			channel = uri.pathname.slice(1); // Remove slash
		}

		if (uri.hash.length > 1) {
			channel += uri.hash;
		}

		// We don't split channels or append # here because the connect window takes care of that
		data.join = channel;
	} catch {
		// Malformed URI (bad port, invalid URL, ...): report empty instead of
		// leaking a half-filled default or throwing inside query-param handling.
		return {};
	}

	return data;
};
