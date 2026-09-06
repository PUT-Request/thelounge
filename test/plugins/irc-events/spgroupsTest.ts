import {EventEmitter} from "node:events";
import {expect} from "vitest";

import Chan from "../../../server/models/chan";
import Network from "../../../server/models/network";
import spgroupsHandler from "../../../server/plugins/irc-events/spgroups";
import spjoinHandler from "../../../server/plugins/irc-events/spjoin";
import unhandledHandler from "../../../server/plugins/irc-events/unhandled";

describe("seedpool enhanced user groups", function () {
	function setup() {
		const irc = new EventEmitter() as any;
		irc.user = {nick: "me"};
		const channel = new Chan({name: "#grouped", caseMapping: "rfc1459"});
		channel.id = 10;
		const network = new Network({name: "test", channels: [channel]});
		network.irc = irc;
		const emitted: Array<{event: string; data: any}> = [];
		const client = {
			idMsg: 1,
			attachedClients: {},
			messageStorage: [],
			emit: (event: string, data: any) => emitted.push({event, data}),
		} as any;

		spgroupsHandler.call(client, irc, network as any);
		spjoinHandler.call(client, irc, network as any);
		unhandledHandler.call(client, irc, network as any);

		return {irc, network, channel, emitted};
	}

	it("validates, casefolds, and consumes SPGROUPS without chat noise", function () {
		const {irc, network, channel, emitted} = setup();
		const lobbyCount = network.getLobby().messages.length;

		irc.emit("unknown command", {
			command: "SPGROUPS",
			params: [
				"#grouped",
				JSON.stringify({
					groups: [{name: "Staff", position: 10, users: ["Nick[", "nick{"]}],
				}),
			],
		});

		expect(channel.groups).to.deep.equal([{name: "Staff", position: 10, users: ["Nick["]}]);
		expect(emitted.map(({event}) => event)).to.deep.equal(["channel:groups"]);
		expect(network.getLobby().messages).to.have.lengthOf(lobbyCount);
	});

	it("SPJOIN updates membership without duplicating a case-equivalent nick", function () {
		const {irc, channel} = setup();
		channel.groups = [
			{name: "One", position: 2, users: ["Nick["]},
			{name: "Two", position: 1, users: []},
		];

		irc.emit("unknown command", {
			command: "SPJOIN",
			params: ["#grouped", "nick{", "Two"],
		});

		expect(channel.groups[0].users).to.be.empty;
		expect(channel.groups[1].users).to.deep.equal(["nick{"]);
	});

	it("rejects an oversized payload without replacing current groups", function () {
		const {irc, channel} = setup();
		channel.groups = [{name: "Existing", position: 1, users: ["alice"]}];

		irc.emit("unknown command", {
			command: "SPGROUPS",
			params: ["#grouped", "x".repeat(256 * 1024 + 1)],
		});

		expect(channel.groups).to.deep.equal([{name: "Existing", position: 1, users: ["alice"]}]);
	});
});
