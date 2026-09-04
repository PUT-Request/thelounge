import {expect} from "vitest";
import {isReactive, toRaw} from "vue";
import {ChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import {
	useCondensedMessages,
	CondensedEntry,
} from "../../../../client/js/hooks/use-condensed-messages";
import type {ClientChan, ClientMessage} from "../../../../client/js/types";

function makeMsg(id: number, type: string = MessageType.MESSAGE, extra = {}): ClientMessage {
	return {
		id,
		type,
		time: new Date(1000 + id),
		text: `message ${id}`,
		...extra,
	} as ClientMessage;
}

function makeChannel(messages: ClientMessage[] = [], firstUnread = 0): ClientChan {
	return {
		id: 1,
		type: ChanType.CHANNEL,
		firstUnread,
		messages,
	} as ClientChan;
}

function snapshot(entries: CondensedEntry[]): any {
	// Strip Vue reactivity proxies so deep-equal compares plain content
	return JSON.parse(JSON.stringify(entries));
}

describe("useCondensedMessages", function () {
	it("matches a full rebuild after appends", function () {
		const mode = "condensed";
		const channel = makeChannel();
		const hook = useCondensedMessages(
			() => channel,
			() => mode
		);

		const expectMatchesRebuild = () => {
			const fresh = useCondensedMessages(
				() => channel,
				() => mode
			);
			expect(snapshot(hook.condensed)).to.deep.equal(snapshot(fresh.condensed));
		};

		// Plain messages, a status run, a highlight break, a self break
		const incoming: ClientMessage[] = [
			makeMsg(1),
			makeMsg(2),
			makeMsg(3, MessageType.JOIN),
			makeMsg(4, MessageType.PART),
			makeMsg(5),
			makeMsg(6, MessageType.JOIN, {highlight: true}),
			makeMsg(7, MessageType.JOIN),
			makeMsg(8, MessageType.QUIT, {self: true}),
			makeMsg(9, MessageType.QUIT),
		];

		for (const msg of incoming) {
			channel.messages.push(msg);
			hook.appendOne(msg);
			expectMatchesRebuild();
		}

		expect(hook.condensed.length).to.be.lessThan(channel.messages.length);
	});

	it("matches a full rebuild after prepends, including container merges", function () {
		const mode = "condensed";
		// Start with a tail that ends in an open status run...
		const channel = makeChannel([
			makeMsg(90, MessageType.JOIN),
			makeMsg(91),
			makeMsg(92, MessageType.PART),
			makeMsg(93, MessageType.QUIT),
		]);
		const hook = useCondensedMessages(
			() => channel,
			() => mode
		);

		// ...then prepend a chunk that itself ends in a status run, so the
		// merge step must join the two adjacent containers.
		const chunk = [makeMsg(80), makeMsg(81, MessageType.JOIN), makeMsg(82, MessageType.JOIN)];
		channel.messages.unshift(...chunk);
		hook.prependChunk(chunk.length);

		const fresh = useCondensedMessages(
			() => channel,
			() => mode
		);
		expect(snapshot(hook.condensed)).to.deep.equal(snapshot(fresh.condensed));

		// [80, 81/JOIN, 82/JOIN] prepended ahead of [90/JOIN, 91, 92/PART,
		// 93/QUIT]: the trailing status run of the chunk merges with 90/JOIN
		// into one container.
		expect(
			hook.condensed.map((e) => (e.type === "condensed" ? `c(${e.messages.length})` : `m`))
		).to.deep.equal(["m", "c(3)", "m", "c(2)"]);
	});

	it("splits containers at the unread boundary", function () {
		const mode = "condensed";
		const channel = makeChannel(
			[makeMsg(1, MessageType.JOIN), makeMsg(2, MessageType.JOIN), makeMsg(3)],
			2
		);
		const hook = useCondensedMessages(
			() => channel,
			() => mode
		);

		expect(
			hook.condensed.map((e) => (e.type === "condensed" ? `c(${e.messages.length})` : `m`))
		).to.deep.equal(["c(2)", "m"]);

		// Appending past the boundary keeps working incrementally
		const msg = makeMsg(4, MessageType.PART);
		channel.messages.push(msg);
		hook.appendOne(msg);

		const fresh = useCondensedMessages(
			() => channel,
			() => mode
		);
		expect(snapshot(hook.condensed)).to.deep.equal(snapshot(fresh.condensed));
	});

	it("rebuilds on mode and channel switches", function () {
		let mode = "condensed";
		const channel = makeChannel([makeMsg(1), makeMsg(2, MessageType.JOIN)]);
		const hook = useCondensedMessages(
			() => channel,
			() => mode
		);

		expect(hook.condensed.length).to.equal(2);

		mode = "hidden";
		hook.appendOne(makeMsg(3));
		expect(hook.condensed.map((e) => (e as ClientMessage).id)).to.deep.equal([1]);

		mode = "shown";
		hook.appendOne(makeMsg(4));
		expect(hook.condensed.length).to.equal(2);

		// A different channel invalidates the incremental bookkeeping
		const other = makeChannel([makeMsg(10, MessageType.JOIN)], 0);
		other.id = 2;
		const hook2 = useCondensedMessages(
			() => other,
			() => "condensed"
		);
		expect(hook2.condensed.length).to.equal(1);
	});

	it("leaves non-channel types unfolded", function () {
		const channel = makeChannel([makeMsg(1, MessageType.JOIN)]);
		channel.type = ChanType.LOBBY;
		const hook = useCondensedMessages(
			() => channel,
			() => "condensed"
		);
		expect(hook.condensed.length).to.equal(1);
		expect(hook.condensed[0].type).to.equal(MessageType.JOIN);
	});
});

describe("chan helpers", function () {
	it("unshiftMany prepends in order without blowing the stack", async function () {
		const {unshiftMany, pushMany} = await import("../../../../client/js/chan");

		const target = [3, 4];
		const items = Array.from({length: 200000}, (_, i) => i);

		unshiftMany(target, items);
		expect(target.length).to.equal(200002);
		expect(target[0]).to.equal(0);
		expect(target[199999]).to.equal(199999);
		expect(target[200000]).to.equal(3);

		const target2: number[] = [];
		pushMany(target2, items);
		expect(target2.length).to.equal(200000);
		expect(target2[199999]).to.equal(199999);
	});

	it("markMsgsRaw opts out of reactivity but keeps previews reactive", async function () {
		const {markMsgsRaw} = await import("../../../../client/js/chan");

		const msgs = markMsgsRaw([
			{text: "hi", previews: [{link: "http://example.com", shown: true}]},
		] as any);

		// The message itself opted out of deep reactivity...
		expect(isReactive(msgs[0])).to.be.false;
		expect(toRaw(msgs[0])).to.equal(msgs[0]);
		// ...while previews (mutated in place by toggles) stayed reactive.
		expect(isReactive(msgs[0].previews)).to.be.true;
	});
});
