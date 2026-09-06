import {expect, vi} from "vitest";

import Config from "../../server/config";
import Msg from "../../server/models/msg";
import MassEventAggregator from "../../server/plugins/massEventAggregator";
import {MessageType} from "../../shared/types/msg";

describe("MassEventAggregator", function () {
	const originalConfig = Config.values.massEventDetection;

	beforeEach(function () {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		Config.values.massEventDetection = {
			enable: true,
			threshold: 3,
			windowMs: 1000,
			cooldownMs: 100,
			maxDurationMs: 5000,
			refreshNamesAfter: false,
		};
	});

	afterEach(function () {
		Config.values.massEventDetection = originalConfig;
		vi.useRealTimers();
	});

	it("summarizes only events suppressed after the threshold is crossed", function () {
		const client = {} as any;
		const pushMessage = vi.fn();
		const channel = {id: 7, name: "#busy", pushMessage} as any;
		const network = {} as any;
		const aggregator = new MassEventAggregator(client);

		expect(aggregator.processMessage(network, channel, new Msg({type: MessageType.JOIN}))).to.be
			.false;
		expect(aggregator.processMessage(network, channel, new Msg({type: MessageType.JOIN}))).to.be
			.false;
		expect(aggregator.processMessage(network, channel, new Msg({type: MessageType.JOIN}))).to.be
			.true;
		expect(aggregator.processMessage(network, channel, new Msg({type: MessageType.PART}))).to.be
			.true;

		vi.advanceTimersByTime(100);

		expect(pushMessage).toHaveBeenCalledOnce();
		const summary = pushMessage.mock.calls[0][1].massEventSummary;
		expect(summary.joins).to.equal(1);
		expect(summary.parts).to.equal(1);
	});

	it("cancels pending summaries when a channel is removed", function () {
		Config.values.massEventDetection.threshold = 1;
		const pushMessage = vi.fn();
		const channel = {id: 8, name: "#gone", pushMessage} as any;
		const aggregator = new MassEventAggregator({} as any);

		expect(aggregator.processMessage({} as any, channel, new Msg({type: MessageType.QUIT}))).to
			.be.true;
		expect(aggregator.isActive(channel.id)).to.be.true;

		aggregator.cleanup(channel.id);
		vi.runAllTimers();

		expect(aggregator.isActive(channel.id)).to.be.false;
		expect(pushMessage).not.toHaveBeenCalled();
	});
});
