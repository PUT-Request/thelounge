import {expect} from "vitest";
import {rainbow} from "../../../server/plugins/inputs/rainbow";

describe("rainbow input", function () {
	it("keeps surrogate pairs and grapheme clusters intact", function () {
		const output = rainbow("A👨‍👩‍👧‍👦éB");

		expect(output).to.equal("\x034A\x037👨‍👩‍👧‍👦\x038é\x039B");
		expect(output).not.to.contain("\ud83d\x03");
	});
});
