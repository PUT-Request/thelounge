import {expect} from "vitest";
import {reactive} from "vue";

import {parser} from "../../../../../client/js/helpers/shoutbox-bridge/parser";
import {MessageType, type SharedMsg} from "../../../../../shared/types/msg";

// Messages in the store carry a reactive previews array (see markMsgRaw),
// including empty ones. structuredClone() cannot clone Vue proxies, so the
// parser must never feed them to it.
function reactiveBridgeMessage(text: string): SharedMsg {
	return reactive({
		id: 1,
		time: new Date(),
		type: MessageType.MESSAGE,
		text,
		from: {nick: "chatbot", mode: "", isBot: true},
		users: [],
		previews: reactive([
			{
				type: "link",
				head: "",
				body: "",
				thumb: "",
				size: 0,
				link: "https://example.org/",
			},
		]),
	}) as unknown as SharedMsg;
}

describe("shoutbox bridge parser", function () {
	it("rewrites bridged senders", function () {
		const parsed = parser(reactiveBridgeMessage("[alice] hello") as SharedMsg) as SharedMsg & {
			bbcodeBeautified?: boolean;
		};

		expect(parsed.from?.nick).to.equal("alice");
		expect(parsed.from?.shoutbox).to.be.true;
		expect(parsed.text).to.equal("hello");
	});

	it("does not mutate the original message", function () {
		const original = reactiveBridgeMessage("[alice] hello");
		parser(original);

		expect(original.from?.nick).to.equal("chatbot");
		expect(original.text).to.equal("[alice] hello");
	});

	it("leaves non-bridged messages untouched", function () {
		const original = reactiveBridgeMessage("just chatting");

		expect(parser(original)).to.equal(original);
	});

	it("does not trust a matching nickname without server bot metadata", function () {
		const original = reactiveBridgeMessage("[alice] hello");
		original.from!.isBot = false;

		expect(parser(original)).to.equal(original);
		expect(original.from?.nick).to.equal("chatbot");
	});
});
