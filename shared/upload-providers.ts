export interface UploadProvider {
	id: string;
	displayName: string;
	requiresURL?: boolean;
	requiresToken: boolean;
	validTtl?: UploadTTL[];
	supportNote?: string;
	/**
	 * Uploads a file to the remote provider.
	 *
	 * Network and response errors surface as rejected promises carrying an
	 * `Error` with a human-readable message; callers must handle rejections.
	 * Concurrent `upload()` calls are independent (fresh `FormData`/request
	 * per call, no shared mutable state), so there is no cross-upload race.
	 *
	 * @param file File to upload.
	 * @param ttl TTL option id from `validTtl` (provider-specific).
	 * @param token Optional API token (required by some providers).
	 * @returns Promise resolving to the public file URL.
	 */
	upload: (
		file: File,
		ttl: string,
		token?: string,
		signal?: AbortSignal,
		requestUrl?: string,
		fetcher?: typeof fetch
	) => Promise<string>;
}

interface UploadTTL {
	id: string;
	displayName: string;
	value: string;
	default?: boolean;
}

const MAX_PROVIDER_RESPONSE_SIZE = 1024 * 1024;

function requireProviderToken(token: string | undefined, provider: string): string {
	if (!token) {
		throw new Error(`API token is required for ${provider} uploads`);
	}

	return token;
}

async function providerFetch(
	url: string,
	init: RequestInit,
	signal?: AbortSignal,
	request: typeof fetch = fetch
): Promise<Response> {
	return request(url, {...init, signal, redirect: "error"});
}

async function readProviderText(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length"));

	if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_SIZE) {
		throw new Error("Upload provider response is too large");
	}

	if (!response.body) {
		return "";
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;

	try {
		while (true) {
			const {done, value} = await reader.read();

			if (done) {
				break;
			}

			length += value.byteLength;

			if (length > MAX_PROVIDER_RESPONSE_SIZE) {
				throw new Error("Upload provider response is too large");
			}

			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}

	const body = new Uint8Array(length);
	let offset = 0;

	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new TextDecoder().decode(body);
}

async function readProviderJson(response: Response): Promise<any> {
	try {
		return JSON.parse(await readProviderText(response));
	} catch (error) {
		if (error instanceof Error && error.message === "Upload provider response is too large") {
			throw error;
		}

		throw new Error("Upload provider returned an invalid response");
	}
}

function requireUploadUrl(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Upload provider did not return a URL");
	}

	let url: URL;

	try {
		url = new URL(value);
	} catch {
		throw new Error("Upload provider did not return a valid URL");
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Upload provider returned an unsafe URL");
	}

	return url.toString();
}

/**
 * Third-party file-upload backends shown in Settings → General.
 *
 * Each entry is self-contained: `upload()` builds a fresh request per call
 * and never touches shared module state, so parallel uploads cannot race.
 * All providers reject (never throw synchronously) on network errors,
 * non-OK HTTP status, or unexpected response shapes.
 */
export const UploadProviders: UploadProvider[] = [
	{
		id: "new",
		displayName: "TheLounge (Local)",
		requiresToken: false,
		validTtl: [
			{
				id: "never",
				displayName: "Never",
				value: "-",
				default: true,
			},
			{
				id: "1hour",
				displayName: "1 Hour",
				value: "3600",
			},
			{
				id: "12hours",
				displayName: "12 Hours",
				value: "43200",
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "86400",
			},
			{
				id: "1week",
				displayName: "1 Week",
				value: "604800",
			},
			{
				id: "1month",
				displayName: "1 Month",
				value: "2592000",
			},
			{
				id: "custom",
				displayName: "Custom",
				value: "custom",
			},
		],
		upload() {
			return Promise.resolve("dummy");
		},
	},
	{
		id: "imagebb",
		displayName: "ImageBB",
		requiresToken: true,
		validTtl: [
			{
				id: "1week",
				displayName: "1 Week",
				value: "604800",
			},
			{
				id: "3days",
				displayName: "3 Days",
				value: "259200",
				default: true,
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "86400",
			},
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-",
			},
		],
		supportNote: "Supported files: Images",
		async upload(file: File, ttl: string, token?: string, signal?: AbortSignal) {
			const uploadTTL = this.validTtl?.find((t) => t.id === ttl);

			const payload = new FormData();
			payload.append("key", requireProviderToken(token, "ImageBB"));
			payload.append("image", file);

			if (uploadTTL && uploadTTL.id !== "forever") {
				payload.append("expiration", uploadTTL.value);
			}

			const response = await providerFetch(
				"https://api.imgbb.com/1/upload",
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const json = await readProviderJson(response);

			if (!response.ok) {
				throw new Error(json.error?.message ?? "Unknown Error");
			}

			return requireUploadUrl(json.data?.url);
		},
	},
	{
		id: "catbox",
		displayName: "Catbox",
		requiresToken: false,
		validTtl: [
			{
				id: "3days",
				displayName: "3 Days",
				value: "72h",
				default: true,
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "24h",
			},
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-",
			},
		],
		supportNote: "Supported files: Images, Videos, Audio, and Text",
		async upload(file: File, ttl: string, _token?: string, signal?: AbortSignal) {
			const uploadTTL = this.validTtl?.find((t) => t.id === ttl);

			const payload = new FormData();
			payload.append("reqtype", "fileupload");
			payload.append("fileToUpload", file);

			let uploadUrl = "https://catbox.moe/user/api.php";

			if (uploadTTL && uploadTTL.id !== "forever") {
				payload.append("time", uploadTTL.value);
				uploadUrl = "https://litterbox.catbox.moe/resources/internals/api.php";
			}

			const response = await providerFetch(
				uploadUrl,
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const url = await readProviderText(response);

			if (!response.ok || !url.startsWith("http")) {
				throw new Error(url ?? "Unknown Error");
			}

			return requireUploadUrl(url);
		},
	},
	{
		id: "ptscreens",
		displayName: "PTScreens",
		requiresToken: true,
		validTtl: [
			{
				id: "1week",
				displayName: "1 Week",
				value: "P7D",
			},
			{
				id: "3days",
				displayName: "3 Days",
				value: "P3D",
				default: true,
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "P1D",
			},
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-",
			},
		],
		supportNote: "Supported files: Images",
		async upload(file: File, ttl: string, token?: string, signal?: AbortSignal) {
			const uploadTTL = this.validTtl?.find((t) => t.id === ttl);

			const payload = new FormData();
			payload.append("format", "txt");
			payload.append("key", requireProviderToken(token, "PTScreens"));
			payload.append("source", file);

			if (uploadTTL && uploadTTL.id !== "forever") {
				payload.append("expiration", uploadTTL.value);
			}

			const response = await providerFetch(
				"https://ptscreens.com/api/1/upload",
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const url = await readProviderText(response);

			if (!response.ok || !url.startsWith("http")) {
				throw new Error(url ?? "Unknown Error");
			}

			return requireUploadUrl(url);
		},
	},
	{
		id: "quax",
		displayName: "qu.ax",
		requiresToken: false,
		validTtl: [
			{
				id: "1week",
				displayName: "1 Week",
				value: "7",
			},
			{
				id: "3days",
				displayName: "3 Days",
				value: "3",
				default: true,
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "1",
			},
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-1",
			},
		],
		supportNote: "Supported files: Images, Video, and Text",
		async upload(file: File, ttl: string, _token?: string, signal?: AbortSignal) {
			const uploadTTL = this.validTtl?.find((t) => t.id === ttl);

			const payload = new FormData();
			payload.append("files[]", file);
			payload.append("expiry", uploadTTL?.value ?? "-1");

			const response = await providerFetch(
				"https://qu.ax/upload",
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const raw = await readProviderText(response);
			let json: any = null;

			try {
				json = JSON.parse(raw);
			} catch {
				// non-JSON response: treat raw text as URL
			}

			if (json) {
				if (!response.ok || json?.success !== true) {
					throw new Error(json?.description ?? "Unknown Error");
				}
			} else if (!response.ok || !raw.startsWith("http")) {
				throw new Error(raw || "Unknown Error");
			}

			// json?.files?.[0]?.url is not the url to the raw image
			const fName = <string>json?.files?.[0]?.file_name;

			// eslint-disable-next-line eqeqeq
			if (fName == null) {
				throw new Error("Unknown Error");
			}

			return requireUploadUrl(`https://qu.ax/x/${fName}.${file.name.split(".").pop()}`);
		},
	},
	{
		id: "uguu",
		displayName: "Uguu",
		requiresToken: false,
		validTtl: [
			{
				id: "3hours",
				displayName: "3 Hours",
				value: "3",
				default: true,
			},
		],
		supportNote: "Supported files: Images, Video, Audio, and Text",
		async upload(file: File, _ttl: string, _token?: string, signal?: AbortSignal) {
			const payload = new FormData();
			payload.append("files[]", file);

			const response = await providerFetch(
				"https://uguu.se/upload",
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const json = await readProviderJson(response);

			if (!response.ok || json?.success !== true) {
				throw new Error(json?.description ?? "Unknown Error");
			}

			return requireUploadUrl(json?.files?.[0]?.url);
		},
	},
	{
		id: "onlyimage",
		displayName: "OnlyImage",
		requiresToken: true,
		validTtl: [
			{
				id: "1week",
				displayName: "1 Week",
				value: "P7D",
			},
			{
				id: "3days",
				displayName: "3 Days",
				value: "P3D",
				default: true,
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "P1D",
			},
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-",
			},
		],
		supportNote: "Supported files: Images",
		async upload(file: File, ttl: string, token?: string, signal?: AbortSignal) {
			const uploadTTL = this.validTtl?.find((t) => t.id === ttl);

			const payload = new FormData();
			payload.append("format", "txt");
			payload.append("key", requireProviderToken(token, "OnlyImage"));
			payload.append("source", file);

			if (uploadTTL && uploadTTL.id !== "forever") {
				payload.append("expiration", uploadTTL.value);
			}

			const response = await providerFetch(
				"https://onlyimage.org/api/1/upload",
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const url = await readProviderText(response);

			if (!response.ok || !url.startsWith("http")) {
				throw new Error(url ?? "Unknown Error");
			}

			return requireUploadUrl(url);
		},
	},
	{
		id: "img.tnb.moe",
		displayName: "img.tnb.moe",
		requiresToken: true,
		validTtl: [
			{
				id: "1week",
				displayName: "1 Week",
				value: "P7D",
			},
			{
				id: "3days",
				displayName: "3 Days",
				value: "P3D",
			},
			{
				id: "1day",
				displayName: "1 Day",
				value: "P1D",
			},
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-",
				default: true,
			},
		],
		supportNote: "Supported files: Images",
		async upload(file: File, ttl: string, token?: string, signal?: AbortSignal) {
			const uploadTTL = this.validTtl?.find((t) => t.id === ttl);

			const payload = new FormData();
			payload.append("format", "txt");
			payload.append("key", requireProviderToken(token, "img.tnb.moe"));
			payload.append("source", file);

			if (uploadTTL && uploadTTL.id !== "forever") {
				payload.append("expiration", uploadTTL.value);
			}

			const response = await providerFetch(
				"https://img.tnb.moe/api/1/upload",
				{
					method: "POST",
					body: payload,
				},
				signal
			);

			const url = await readProviderText(response);

			if (!response.ok || !url.startsWith("http")) {
				throw new Error(url ?? "Unknown Error");
			}

			return requireUploadUrl(url);
		},
	},
	{
		id: "ptpimg",
		displayName: "ptpimg",
		requiresToken: true,
		validTtl: [
			{
				id: "forever",
				displayName: "Keep Forever",
				value: "-",
				default: true,
			},
		],
		supportNote: "Supported files: Images",
		async upload(file: File, _ttl: string, token?: string, signal?: AbortSignal) {
			const payload = new FormData();
			payload.append("format", "json");
			payload.append("api_key", requireProviderToken(token, "ptpimg"));
			payload.append("file-upload[0]", file);

			const response = await providerFetch(
				"https://ptpimg.me/upload.php",
				{
					method: "POST",
					headers: {
						referer: "https://ptpimg.me/index.php",
					},
					body: payload,
				},
				signal
			);

			const json = await readProviderJson(response);

			if (!response.ok || !json?.[0]?.code || !json?.[0]?.ext) {
				throw new Error(json?.error?.message ?? "Unknown Error");
			}

			return requireUploadUrl(`https://ptpimg.me/${json[0].code}.${json[0].ext}`);
		},
	},
	{
		id: "xbackbone",
		displayName: "XBackBone",
		requiresURL: true,
		requiresToken: true,
		supportNote:
			"Supported files: Images, Videos, Audio, and Text\nNOTE: You must have 'Hide Media by Default' disabled for your profile",
		async upload(
			file: File,
			_ttl: string,
			token?: string,
			signal?: AbortSignal,
			requestUrl?: string,
			fetcher?: typeof fetch
		) {
			const auth = requireProviderToken(token, "XBackBone");

			if (!requestUrl) {
				throw new Error("Upload URL is required for XBackBone uploads");
			}

			const payload = new FormData();

			payload.append("token", auth);
			payload.append("upload", file);

			const response = await providerFetch(
				requestUrl,
				{
					method: "POST",
					body: payload,
				},
				signal,
				fetcher
			);

			const json = await readProviderJson(response);

			if (!response.ok) {
				throw new Error("Unknown Error");
			}

			return requireUploadUrl(json.raw_url);
		},
	},
];
