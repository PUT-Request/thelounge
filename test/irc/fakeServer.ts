import net from "net";

// Minimal scriptable IRC server for end-to-end protocol tests. Speaks just
// enough IRC to drive a real irc-framework client through registration,
// capability negotiation, joins, and message playback. Anything unscripted
// is recorded and ignored so tests only assert what they care about.
export class FakeIrcServer {
	private server: net.Server | null = null;
	private sockets: net.Socket[] = [];
	private buffer = "";
	private waiters: Array<{
		match: (line: string) => boolean;
		resolve: (line: string) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];

	port = 0;
	received: string[] = [];
	onLine: ((line: string, send: (line: string) => void) => void) | null = null;

	async start(): Promise<void> {
		this.server = net.createServer((socket) => {
			this.sockets.push(socket);
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => this.feed(chunk));
			socket.on("close", () => {
				this.sockets = this.sockets.filter((s) => s !== socket);
			});
		});

		await new Promise<void>((resolve) => {
			this.server!.listen(0, "127.0.0.1", () => resolve());
		});

		const address = this.server!.address();

		if (typeof address === "object" && address !== null) {
			this.port = address.port;
		}
	}

	private feed(chunk: string): void {
		this.buffer += chunk;
		let index = this.buffer.indexOf("\r\n");

		while (index !== -1) {
			const line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 2);
			this.received.push(line);

			for (let i = this.waiters.length - 1; i >= 0; i--) {
				const waiter = this.waiters[i];

				if (waiter.match(line)) {
					clearTimeout(waiter.timer);
					this.waiters.splice(i, 1);
					waiter.resolve(line);
				}
			}

			if (this.onLine) {
				this.onLine(line, (reply) => this.send(reply));
			}

			index = this.buffer.indexOf("\r\n");
		}
	}

	send(line: string): void {
		for (const socket of this.sockets) {
			socket.write(line + "\r\n");
		}
	}

	waitForLine(match: (line: string) => boolean, timeoutMs = 5000): Promise<string> {
		for (const line of this.received) {
			if (match(line)) {
				return Promise.resolve(line);
			}
		}

		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				const index = this.waiters.findIndex((w) => w.resolve === resolve);

				if (index !== -1) {
					this.waiters.splice(index, 1);
				}

				const tail = this.received.slice(-10).join(" | ");
				reject(
					new Error(
						`timed out waiting for line (got ${this.received.length} lines: ${tail})`
					)
				);
			}, timeoutMs);

			this.waiters.push({match, resolve, timer});
		});
	}

	async waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
		const start = Date.now();

		while (!predicate()) {
			if (Date.now() - start > timeoutMs) {
				throw new Error("timed out waiting for condition");
			}

			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}

	async close(): Promise<void> {
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer);
		}

		this.waiters = [];

		for (const socket of this.sockets) {
			socket.destroy();
		}

		this.sockets = [];

		if (this.server) {
			await new Promise<void>((resolve) => this.server!.close(() => resolve()));
			this.server = null;
		}
	}
}
