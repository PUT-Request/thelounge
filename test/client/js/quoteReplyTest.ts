import {expect} from "vitest";

import {formatQuoteReply} from "../../../client/js/helpers/quoteReply";

describe("formatQuoteReply", function () {
	it("formats nick and text as an IRC quote", function () {
		expect(formatQuoteReply("alice", "hello world")).to.equal(
			'\x02alice\x02: \x0314,99"\x1Dhello world\x1D"\x03'
		);
	});

	it("uses the first non-empty line of multiline text", function () {
		expect(formatQuoteReply("bob", "\n\nsecond line\nthird")).to.equal(
			'\x02bob\x02: \x0314,99"\x1Dsecond line\x1D"\x03'
		);
	});

	it("truncates long content", function () {
		const long = "x".repeat(500);
		const result = formatQuoteReply("carol", long);
		expect(result).to.contain("x".repeat(200));
		expect(result).to.not.contain("x".repeat(201));
	});

	it("returns null without nick or text", function () {
		expect(formatQuoteReply("", "hi")).to.be.null;
		expect(formatQuoteReply("alice", "")).to.be.null;
		expect(formatQuoteReply("alice", "   \n  ")).to.be.null;
	});
});
