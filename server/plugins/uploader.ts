import Config from "../config";
import busboy, {BusboyHeaders} from "@fastify/busboy";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import log from "../log";
import contentDisposition from "content-disposition";
import mimeTypes from "mime-types";
import type {Socket} from "socket.io";
import type {Request, Response as ExpressResponse} from "express";
import NodeBuffer, {Buffer} from "buffer";
import {UploadProviders, UploadProvider} from "../../shared/upload-providers";
import {Agent, fetch as undiciFetch} from "undici";
import {resolvePublicHostname} from "../publicNetwork";

type UploadAuthorization = {
	timeout: ReturnType<typeof setTimeout>;
	service: string;
	ownerTokens: Set<string>;
};

// Map of mime types to their more common aliases
const mimeAliases: {[key: string]: string} = {
	"audio/vnd.wave": "audio/wav",
	"audio/x-flac": "audio/flac",
	"audio/x-m4a": "audio/mp4",
	"video/quicktime": "video/mp4",
};

// Map of allowed  mime types to their respecive default filenames
// that will be rendered in browser without forcing them to be downloaded.
// Use post alias mime types.
const inlineContentDispositionTypes = {
	"application/ogg": "media.ogx",
	"audio/midi": "audio.midi",
	"audio/mpeg": "audio.mp3",
	"audio/ogg": "audio.ogg",
	"audio/wav": "audio.wav",
	"audio/flac": "audio.flac",
	"audio/mp4": "audio.m4a",
	"image/bmp": "image.bmp",
	"image/gif": "image.gif",
	"image/jpeg": "image.jpg",
	"image/png": "image.png",
	"image/webp": "image.webp",
	"image/avif": "image.avif",
	"image/jxl": "image.jxl",
	"text/plain": "text.txt",
	"video/mp4": "video.mp4",
	"video/ogg": "video.ogv",
	"video/webm": "video.webm",
};

const uploadTokens = new Map<string, UploadAuthorization>();

const MAX_OUTSTANDING_TOKENS_PER_SOCKET = 5;
const MAX_CONCURRENT_EXTERNAL_RELAYS = 4;
const MAX_EXTERNAL_RELAY_SIZE = 50 * 1024 * 1024;
const PROVIDER_REQUEST_TIMEOUT = 30 * 1000;
const MAX_PROVIDER_TOKEN_LENGTH = 4096;
const MAX_PROVIDER_URL_LENGTH = 2048;
let activeExternalRelays = 0;

const EXPIRY_SUFFIX = ".expires";
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

class Uploader {
	constructor(socket: Socket) {
		const socketTokens = new Set<string>();

		socket.on("upload:auth", (data) => {
			if (socketTokens.size >= MAX_OUTSTANDING_TOKENS_PER_SOCKET) {
				return;
			}

			const requestedService = typeof data?.service === "string" ? data.service : "new";
			const service =
				Config.values.allowFileUploadBackendSelection &&
				UploadProviders.some((provider) => provider.id === requestedService)
					? requestedService
					: "new";
			const token = crypto.randomUUID();
			socketTokens.add(token);

			// Invalidate the token in one minute
			const timeout = Uploader.createTokenTimeout(token, socketTokens);

			uploadTokens.set(token, {timeout, service, ownerTokens: socketTokens});

			socket.emit("upload:auth", token);
		});

		socket.on("upload:ping", (token) => {
			if (typeof token !== "string") {
				return;
			}

			const authorization = uploadTokens.get(token);

			if (!authorization || authorization.ownerTokens !== socketTokens) {
				return;
			}

			clearTimeout(authorization.timeout);
			authorization.timeout = Uploader.createTokenTimeout(token, socketTokens);
		});

		socket.once("disconnect", () => {
			for (const token of socketTokens) {
				Uploader.consumeAuthorization(token);
			}
		});
	}

	static createTokenTimeout(this: void, token: string, ownerTokens: Set<string>) {
		const timeout = setTimeout(() => {
			uploadTokens.delete(token);
			ownerTokens.delete(token);
		}, 60 * 1000);
		timeout.unref();
		return timeout;
	}

	static consumeAuthorization(this: void, token: string) {
		const authorization = uploadTokens.get(token);

		if (!authorization) {
			return undefined;
		}

		clearTimeout(authorization.timeout);
		authorization.ownerTokens.delete(token);
		uploadTokens.delete(token);
		return authorization;
	}

	// TODO: type
	static router(this: void, express: any) {
		// NOTE: express 5 (path-to-regexp v8) no longer accepts the `:slug*?`
		// modifier syntax, so the optional human-friendly filename suffix is
		// expressed as two routes instead. `{*slug}` captures zero or more
		// trailing segments; normalize the array form back to a path.
		express.get("/uploads/:name", Uploader.routeGetFile);
		express.get("/uploads/:name/{*slug}", Uploader.routeGetFile);
		express.post("/uploads/new/:token", Uploader.routeUploadFile);
		express.post("/uploads/:service/:token", Uploader.routeUploadFile);
		express.post("/uploads/:service/:token/:ttl", Uploader.routeUploadFile);
	}

	static async routeGetFile(this: void, req: Request, res: ExpressResponse) {
		// Express 5 types params as string | string[] (segments can repeat);
		// normalize back to a single value. A joined multi-segment `name`
		// can never match the hex regex below, so this stays a 404.
		const firstParam = (value: string | string[] | undefined): string =>
			Array.isArray(value) ? value.join("/") : (value ?? "");
		const name = firstParam(req.params.name);

		const nameRegex = /^[0-9a-f]{16}$/;

		if (!nameRegex.test(name)) {
			return res.status(404).send("Not found");
		}

		const folder = name.substring(0, 2);
		const uploadPath = Config.getFileUploadPath();
		const filePath = path.join(uploadPath, folder, name);
		let detectedMimeType = await Uploader.getFileType(filePath);

		// doesn't exist
		if (detectedMimeType === null) {
			return res.status(404).send("Not found");
		}

		// Send a more common mime type for audio files
		// so that browsers can play them correctly
		detectedMimeType = mimeAliases[detectedMimeType] || detectedMimeType;

		// Force a download in the browser if it's not an allowed type (binary or otherwise unknown)
		// The `{*slug}` route captures trailing segments as an array;
		// join it back (filenames never contain slashes in practice, but the
		// old `:slug*?` route tolerated them too).
		let slug = firstParam(req.params.slug) || undefined;
		const isInline = detectedMimeType in inlineContentDispositionTypes;
		let disposition = isInline ? "inline" : "attachment";

		if (!slug && isInline) {
			slug = inlineContentDispositionTypes[detectedMimeType];
		}

		if (slug) {
			disposition = contentDisposition(slug.trim(), {
				fallback: false,
				type: disposition,
			});
		}

		res.setHeader("Content-Disposition", disposition);
		res.setHeader("Cache-Control", "max-age=86400");
		res.contentType(detectedMimeType);

		return res.sendFile(filePath);
	}

	static routeUploadFile(this: void, req: Request, res: ExpressResponse) {
		let busboyInstance: busboy | null = null;
		let uploadUrl: string | URL | undefined;
		let randomName: string;
		let originalFilename = "";
		let destDir: fs.PathLike;
		let destPath: fs.PathLike | null = null;
		let streamWriter: fs.WriteStream | null = null;
		let receivedFile = false;
		let providerToken = "";
		let providerUrl = "";
		let relaySlotHeld = false;
		let settled = false;

		// `/uploads/new/:token` (legacy local) vs `/uploads/:service/:token/:ttl?`
		const service: string = (req.params as any).service ?? "new";
		const token: string = (req.params as any).token;
		const ttl: string = (req.params as any).ttl ?? "";
		const uploadProvider = UploadProviders.find((b) => b.id === service);

		const releaseRelaySlot = () => {
			if (relaySlotHeld) {
				activeExternalRelays--;
				relaySlotHeld = false;
			}
		};

		const doneCallback = () => {
			// detach the stream and drain any remaining data
			if (busboyInstance) {
				req.unpipe(busboyInstance);
				req.on("readable", req.read.bind(req));

				busboyInstance.removeAllListeners();
				busboyInstance = null;
			}

			// close the output file stream
			if (streamWriter) {
				streamWriter.end();
				streamWriter = null;
			}
		};

		const removeDestination = () => {
			if (!destPath) {
				return;
			}

			try {
				fs.unlinkSync(destPath);
			} catch (error: any) {
				if (error?.code !== "ENOENT") {
					log.warn(`Failed to remove incomplete upload ${String(destPath)}: ${error}`);
				}
			}

			destPath = null;
		};

		const abortWithError = (err: any, status = 400) => {
			if (settled) {
				return res;
			}

			settled = true;
			doneCallback();
			releaseRelaySlot();
			removeDestination();

			return res.status(status).json({
				error: err instanceof Error ? err.message : "Upload failed",
			});
		};

		req.once("aborted", () => {
			if (!settled) {
				settled = true;
				doneCallback();
				releaseRelaySlot();
				removeDestination();
			}
		});
		req.setTimeout(2 * 60 * 1000, () => req.destroy(new Error("Upload request timed out")));

		// if the authentication token is incorrect, bail out
		if (!uploadProvider) {
			return abortWithError(Error("Invalid upload provider"));
		}

		const authorization = uploadTokens.get(token);

		if (!authorization || authorization.service !== service) {
			return abortWithError(Error("Invalid upload token"), 401);
		}

		Uploader.consumeAuthorization(token);

		if (service !== "new") {
			if (activeExternalRelays >= MAX_CONCURRENT_EXTERNAL_RELAYS) {
				return abortWithError(Error("Too many external uploads in progress"), 429);
			}

			activeExternalRelays++;
			relaySlotHeld = true;
		}

		// if the request does not contain any body data, bail out
		if (req.headers["content-length"] && parseInt(req.headers["content-length"]) < 1) {
			return abortWithError(Error("Length Required"));
		}

		// Only allow multipart, as busboy can throw an error on unsupported types
		if (!(
			req.headers["content-type"] &&
			req.headers["content-type"].startsWith("multipart/form-data")
		)) {
			return abortWithError(Error("Unsupported Content Type"));
		}

		// create a new busboy processor, it is wrapped in try/catch
		// because it can throw on malformed headers
		try {
			busboyInstance = new busboy({
				headers: req.headers as BusboyHeaders,
				limits: {
					files: 1, // only allow one file per upload
					fields: 2,
					parts: 3,
					fieldSize: Math.max(MAX_PROVIDER_TOKEN_LENGTH, MAX_PROVIDER_URL_LENGTH),
					fileSize: Uploader.getMaxFileSize(service),
				},
			});
		} catch (err) {
			return abortWithError(err);
		}

		// Any error or limit from busboy will abort the upload with an error
		busboyInstance.on("error", abortWithError);
		busboyInstance.on("partsLimit", () => abortWithError(Error("Parts limit reached")));
		busboyInstance.on("filesLimit", () => abortWithError(Error("Files limit reached")));
		busboyInstance.on("fieldsLimit", () => abortWithError(Error("Fields limit reached")));
		busboyInstance.on("field", (name: string, value: string) => {
			if (name === "providerToken") {
				providerToken = value;
			} else if (name === "providerUrl") {
				providerUrl = value;
			}
		});

		// generate a random output filename for the file
		// we use do/while loop to prevent the rare case of generating a file name
		// that already exists on disk
		do {
			randomName = crypto.randomBytes(8).toString("hex");
			destDir = path.join(Config.getFileUploadPath(), randomName.substring(0, 2));
			destPath = path.join(destDir, randomName);
		} while (fs.existsSync(destPath));

		busboyInstance.on(
			"file",
			(
				fieldname: any,
				fileStream: {
					on: (arg0: string, arg1: {(err: any): ExpressResponse; (): void}) => void;
					unpipe: (arg0: any) => void;
					read: {bind: (arg0: any) => any};
					pipe: (arg0: any) => void;
				},
				filename: string | number | boolean
			) => {
				receivedFile = true;

				// Split filenames into subdirectories, but do not create anything
				// until Busboy has actually produced a file part.
				try {
					fs.mkdirSync(destDir, {recursive: true});
				} catch (err: any) {
					log.error(`Error ensuring ${destDir} exists for uploads: ${err.message}`);
					abortWithError(err);
					return;
				}

				streamWriter = fs.createWriteStream(destPath as string);
				streamWriter.on("error", abortWithError);
				uploadUrl = `${randomName}/${encodeURIComponent(filename)}`;
				originalFilename = String(filename);

				if (Config.values.fileUpload.baseUrl) {
					uploadUrl = new URL(uploadUrl, Config.values.fileUpload.baseUrl).toString();
				} else {
					uploadUrl = `uploads/${uploadUrl}`;
				}

				// if the busboy data stream errors out or goes over the file size limit
				// abort the processing with an error
				// @ts-expect-error Argument of type '(err: any) => Response<any, Record<string, any>>' is not assignable to parameter of type '{ (err: any): Response<any, Record<string, any>>; (): void; }'.ts(2345)
				fileStream.on("error", abortWithError);
				fileStream.on("limit", () => {
					fileStream.unpipe(streamWriter);
					fileStream.on("readable", fileStream.read.bind(fileStream));

					return abortWithError(Error("File size limit reached"));
				});

				// Attempt to write the stream to file
				fileStream.pipe(streamWriter);
			}
		);

		busboyInstance.on("finish", () => {
			if (settled) {
				return;
			}

			if (!receivedFile) {
				return abortWithError(Error("Missing file"));
			}

			if (service !== "new" && uploadProvider) {
				// service upload: relay the temp file to the remote provider
				const provider = uploadProvider;

				const relay = async () => {
					let file: File;
					let requestUrl: string | undefined;
					let dispatcher: Agent | undefined;

					try {
						if (
							providerToken.length > MAX_PROVIDER_TOKEN_LENGTH ||
							providerUrl.length > MAX_PROVIDER_URL_LENGTH
						) {
							throw new Error("Upload provider credentials are too long");
						}

						if (provider.requiresToken && !providerToken) {
							throw new Error("Missing upload provider API key");
						}

						if (provider.requiresURL) {
							requestUrl =
								await Uploader.validateExternalUploadDestination(providerUrl);
							dispatcher = Uploader.createPublicDispatcher();
						}

						const data = await fs.promises.readFile(destPath as string);
						const type =
							(mimeTypes.lookup(originalFilename) as string) ||
							"application/octet-stream";
						file = new File([new Blob([new Uint8Array(data)])], originalFilename, {
							type,
						});

						const signal = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT);
						const fetcher: typeof fetch | undefined = dispatcher
							? async (input: RequestInfo | URL, init?: RequestInit) =>
									(await undiciFetch(
										input as any,
										{
											...init,
											dispatcher,
										} as any
									)) as unknown as Response
							: undefined;
						const url = await provider.upload(
							file,
							ttl,
							providerToken,
							signal,
							requestUrl,
							fetcher
						);

						if (settled) {
							return;
						}

						settled = true;
						releaseRelaySlot();
						fs.unlink(destPath as string, () => undefined);
						res.status(200).json({url});
					} catch (err: any) {
						abortWithError(err);
					} finally {
						await dispatcher?.close().catch(() => undefined);
					}
				};

				if (!streamWriter || (streamWriter as any).closed === true) {
					void relay();
				} else {
					streamWriter?.once("finish", () => void relay());
				}

				doneCallback();
				return;
			}

			doneCallback();

			if (!uploadUrl) {
				return abortWithError(Error("Missing file"));
			}

			Uploader.writeExpiry(destPath as string, uploadProvider, ttl);

			// upload was done, send the generated file url to the client
			settled = true;
			res.status(200).json({
				url: uploadUrl,
			});
		});

		// pipe request body to busboy for processing
		return req.pipe(busboyInstance);
	}

	// Records an expiry timestamp for a locally stored upload, if a valid TTL was requested.
	static writeExpiry(this: void, filePath: string, uploadProvider: UploadProvider, ttl: string) {
		const ttlEntry = uploadProvider.validTtl?.find((t) => t.id === ttl);
		let ttlSeconds: number;

		if (ttlEntry) {
			if (ttlEntry.value === "-" || ttlEntry.id === "custom") {
				return;
			}

			ttlSeconds = parseInt(ttlEntry.value, 10);
		} else {
			ttlSeconds = parseInt(ttl, 10);
		}

		if (Number.isNaN(ttlSeconds) || ttlSeconds <= 0) {
			return;
		}

		const expiresAt = Date.now() + ttlSeconds * 1000;

		try {
			fs.writeFileSync(`${filePath}${EXPIRY_SUFFIX}`, String(expiresAt));
		} catch (err: unknown) {
			log.warn(
				`Failed to write expiry metadata for ${filePath}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	// Scans the upload folder for expired local uploads and removes them
	static async pruneExpiredUploads(this: void) {
		const uploadPath = Config.getFileUploadPath();
		let subDirs: string[];

		try {
			subDirs = await fs.promises.readdir(uploadPath);
		} catch {
			return;
		}

		const now = Date.now();

		for (const subDir of subDirs) {
			const dirPath = path.join(uploadPath, subDir);
			let entries: string[];

			try {
				entries = await fs.promises.readdir(dirPath);
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (!entry.endsWith(EXPIRY_SUFFIX)) {
					continue;
				}

				const expiryPath = path.join(dirPath, entry);
				const filePath = expiryPath.slice(0, -EXPIRY_SUFFIX.length);

				let expiresAt: number;

				try {
					expiresAt = parseInt(await fs.promises.readFile(expiryPath, "utf8"), 10);
				} catch {
					continue;
				}

				if (Number.isNaN(expiresAt) || expiresAt > now) {
					continue;
				}

				await Promise.all([
					fs.promises.rm(filePath, {force: true}),
					fs.promises.rm(expiryPath, {force: true}),
				]);

				log.info(`Removed expired upload: ${filePath}`);
			}

			try {
				if ((await fs.promises.readdir(dirPath)).length === 0) {
					await fs.promises.rmdir(dirPath);
				}
			} catch {
				// not empty, or already removed - ignore
			}
		}
	}

	// Starts the periodic sweep that removes local uploads past their TTL
	static startExpiryCleanup(this: void) {
		const run = () => {
			void Uploader.pruneExpiredUploads().catch((error: unknown) => {
				log.warn(
					`Failed to prune expired uploads: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			});
		};

		run();
		setInterval(run, CLEANUP_INTERVAL).unref();
	}

	static async validateExternalUploadDestination(this: void, value: string) {
		let url: URL;

		try {
			url = new URL(value);
		} catch {
			throw new Error("Invalid external upload URL");
		}

		if (url.protocol !== "https:" || url.username || url.password) {
			throw new Error("External upload URLs must use HTTPS without embedded credentials");
		}

		if (!Config.values.fileUpload.externalUploadOrigins.includes(url.origin)) {
			throw new Error("External upload origin is not allowed by the server administrator");
		}

		await resolvePublicHostname(url.hostname);
		return url.toString();
	}

	static createPublicDispatcher(this: void) {
		return new Agent({
			connect: {
				lookup(hostname, _options, callback) {
					void resolvePublicHostname(hostname)
						.then((addresses) => {
							const selected = addresses[0];
							callback(null, selected.address, selected.family);
						})
						.catch((error: Error) => callback(error, ""));
				},
			},
		});
	}

	static getMaxFileSize(service = "new") {
		const configOption = Config.values.fileUpload.maxFileSize;
		const configuredLimit = configOption < 1 ? Infinity : configOption * 1024;

		if (service !== "new") {
			return Math.min(configuredLimit, MAX_EXTERNAL_RELAY_SIZE);
		}

		return configuredLimit;
	}

	// Returns null if an error occurred (e.g. file not found)
	// Returns a string with the type otherwise
	static async getFileType(filePath: string) {
		try {
			const handle = await fs.promises.open(filePath, "r");
			const buffer = Buffer.alloc(5120);
			await handle.read(buffer, 0, 5120, 0);
			await handle.close();

			// file-type v17+ is ESM-only with named exports, so it is
			// imported dynamically (the server is CommonJS). Returns
			// {ext, mime} if found, null if not.
			const {fileTypeFromBuffer} = await import("file-type");
			const file = await fileTypeFromBuffer(buffer);

			// if a file type was detected correctly, return it
			if (file) {
				return file.mime;
			}

			// if the buffer is a valid UTF-8 buffer, use text/plain
			if (NodeBuffer.isUtf8(buffer)) {
				return "text/plain";
			}

			// otherwise assume it's random binary data
			return "application/octet-stream";
		} catch (e: any) {
			if (e.code !== "ENOENT") {
				log.warn(`Failed to read ${filePath}: ${e.message}`);
			}
		}

		return null;
	}
}

export default Uploader;
