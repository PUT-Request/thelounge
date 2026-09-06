import {expect} from "vitest";
import {condensedTypes, ircCasefold} from "../../shared/irc";

describe(".condensedTypes", function () {
	it("should be a non-empty array", function () {
		expect(condensedTypes).to.be.an.instanceof(Set).that.is.not.empty;
	});

	it("should only contain ASCII strings", function () {
		condensedTypes.forEach((type) => {
			expect(type).to.be.a("string").that.does.match(/^\w+$/);
		});
	});
});

describe("ircCasefold", function () {
	it("uses ASCII rules when advertised", function () {
		expect(ircCasefold("Nick[\\^", "ascii")).to.equal("nick[\\^");
	});

	it("uses strict RFC1459 equivalences", function () {
		expect(ircCasefold("Nick[\\^", "strict-rfc1459")).to.equal("nick{|^");
	});

	it("uses RFC1459 caret/tilde equivalence", function () {
		expect(ircCasefold("Nick[\\^", "rfc1459")).to.equal("nick{|~");
	});

	it("returns an empty string for non-string input instead of throwing", function () {
		// A topic received at join time (RPL_TOPIC) has no setter nick, so
		// data.nick is undefined; casefolding it must not crash the handler.
		expect(ircCasefold(undefined as unknown as string)).to.equal("");
		expect(ircCasefold(null as unknown as string)).to.equal("");
	});
});
