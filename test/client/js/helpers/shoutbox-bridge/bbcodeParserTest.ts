// @vitest-environment jsdom
import {expect} from "vitest";

import {mount} from "@vue/test-utils";
import ParsedMessage from "../../../../../client/components/ParsedMessage.vue";
import type {ClientMessage} from "../../../../../client/js/types";
import {MessageType} from "../../../../../shared/types/msg";

function getParsedMessageContents(text: string, message?: Partial<ClientMessage>) {
	const wrapper = mount(ParsedMessage, {
		props: {
			text,
			message: {
				id: 1,
				time: new Date(),
				type: MessageType.MESSAGE,
				users: [],
				bbcodeBeautified: true,
				from: {
					mode: "",
					shoutbox: true,
					nick: "bot",
				},
				...message,
			} as ClientMessage,
		},
	});

	return wrapper.html();
}

describe("BBCode parser", () => {
	it("should parse nested formatting", () => {
		expect(getParsedMessageContents("[b]bold and [i]italic[/i][/b]")).to.equal(
			'<span class="irc-bold">bold and <span class="irc-italic">italic</span></span>'
		);
	});

	it("should render lists", () => {
		expect(getParsedMessageContents("[list][*]one[*]two[/list]")).to.equal(
			'<ul class="bbcode-list">\n  <li>one</li>\n  <li>two</li>\n</ul>'
		);
	});

	it("should keep urls inside bbcode", () => {
		expect(
			getParsedMessageContents("[quote][url=https://thelounge.chat]thelounge[/url][/quote]")
		).to.equal(
			'<blockquote class="bbcode-quote"><a href="https://thelounge.chat" dir="auto" target="_blank" rel="noopener">thelounge</a></blockquote>'
		);
	});

	it("should add a quote attribution header when a user is provided", () => {
		expect(getParsedMessageContents("[quote=bot]hello[/quote]")).to.equal(
			'<blockquote class="bbcode-quote"><cite class="bbcode-cite"><i class="fas fa-quote-left"></i>Quoting bot:</cite>hello</blockquote>'
		);
	});

	it("should ignore image wrappers", () => {
		expect(getParsedMessageContents("[img=350]https://example.org/image.png[/img]")).to.equal(
			'<a href="https://example.org/image.png" dir="auto" target="_blank" rel="noopener">https://example.org/image.png</a>'
		);
	});
});
