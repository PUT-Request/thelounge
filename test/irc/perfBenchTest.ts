import {expect} from "vitest";
import Msg from "../../server/models/msg";
import {MessageType} from "../../shared/types/msg";
import {matchers} from "../../client/js/helpers/shoutbox-bridge/matchers";

describe("perf spot-checks (not assertions on speed, guards complexity)", function () {
	it("prettyMessage-style matcher scan stays linear-ish", function () {
		const N = 20000;
		const start = Date.now();
		let hits = 0;

		for (let i = 0; i < N; i++) {
			const m = matchers.find((mm: any) =>
				mm.type === "basic" ? mm.matches.includes("someuser") : mm.matches("someuser")
			);
			if (m) hits++;
		}

		const elapsed = Date.now() - start;
		expect(hits).to.equal(0);
		// 20k scans should take well under a second; fails loudly on accidental blowup
		expect(elapsed).to.be.lessThan(1000);
	});

	it("historyDedupeKey scans are cheap", async function () {
		const {historyDedupeKey} = await import("../../server/models/chan");
		const msgs: Msg[] = [];

		for (let i = 0; i < 5000; i++) {
			msgs.push(new Msg({id: i, text: `message ${i}`, type: MessageType.MESSAGE} as any));
		}

		const start = Date.now();
		const keys = new Set(msgs.map((m) => historyDedupeKey(m)));
		expect(keys.size).to.equal(5000);
		expect(Date.now() - start).to.be.lessThan(1000);
	});
});
