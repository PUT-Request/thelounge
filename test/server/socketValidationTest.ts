import {expect} from "vitest";

import {
	isValidBooleanTargetChange,
	isValidInvitationDismiss,
	isValidSearchQuery,
	isValidTarget,
} from "../../server/socketValidation";

describe("Socket.IO payload validation", function () {
	it("rejects malformed targets and boolean change messages", function () {
		for (const value of [undefined, null, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
			expect(isValidTarget(value)).to.be.false;
		}

		expect(isValidBooleanTargetChange(null, "setMutedTo")).to.be.false;
		expect(isValidBooleanTargetChange({target: 1}, "setMutedTo")).to.be.false;
		expect(isValidBooleanTargetChange({target: 1, setMutedTo: true}, "setMutedTo")).to.be.true;
		expect(isValidBooleanTargetChange({target: 1, setPinnedTo: false}, "setPinnedTo")).to.be
			.true;
	});

	it("bounds search scope, terms, and offsets", function () {
		const valid = {
			searchTerm: "hello",
			networkUuid: "network",
			channelName: "#channel",
			offset: 0,
		};
		expect(isValidSearchQuery(valid)).to.be.true;
		expect(isValidSearchQuery(null)).to.be.false;
		expect(isValidSearchQuery({...valid, channelName: ""})).to.be.false;
		expect(isValidSearchQuery({...valid, offset: -1})).to.be.false;
		expect(isValidSearchQuery({...valid, offset: 10001})).to.be.false;
		expect(isValidSearchQuery({...valid, searchTerm: "x".repeat(513)})).to.be.false;
	});

	it("requires a bounded invitation channel", function () {
		expect(isValidInvitationDismiss(null)).to.be.false;
		expect(isValidInvitationDismiss({target: 1, channel: ""})).to.be.false;
		expect(isValidInvitationDismiss({target: 1, channel: "x".repeat(513)})).to.be.false;
		expect(isValidInvitationDismiss({target: 1, channel: "#valid"})).to.be.true;
	});
});
