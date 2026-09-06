import {expect} from "vitest";

import {
	parseCollapsedDirectMessages,
	reorderDirectMessages,
} from "../../../client/js/directMessages";

describe("direct-message ordering", function () {
	it("reorders visible queries while preserving hidden queries and non-query slots", function () {
		const all = [1, 10, 2, 11, 12, 3].map((id) => ({id}));
		const queries = [10, 11, 12].map((id) => ({id}));
		const visible = [10, 12].map((id) => ({id}));

		expect(reorderDirectMessages(all, queries, visible, 0, 1)).to.deep.equal([
			1, 12, 2, 11, 10, 3,
		]);
	});

	it("rejects invalid drag indices", function () {
		expect(reorderDirectMessages([{id: 1}], [{id: 1}], [{id: 1}], -1, 0)).to.be.null;
	});

	it("recovers safely from corrupt persisted state", function () {
		expect([...parseCollapsedDirectMessages("not-json")]).to.deep.equal([]);
		expect([...parseCollapsedDirectMessages('{"wrong":true}')]).to.deep.equal([]);
		expect([...parseCollapsedDirectMessages('["a", 1, "b"]')]).to.deep.equal(["a", "b"]);
	});
});
