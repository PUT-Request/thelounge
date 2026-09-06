// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {expect, vi} from "vitest";

const {eventEmit, routerPush, storeMock} = vi.hoisted(() => ({
	eventEmit: vi.fn(),
	routerPush: vi.fn(() => Promise.resolve()),
	storeMock: {
		state: {
			networks: [],
			activeChannel: {channel: {id: 42, name: "#active"}},
		},
		getters: {findChannel: vi.fn()},
	},
}));

vi.mock("../../../client/js/eventbus", () => ({default: {emit: eventEmit}}));
vi.mock("../../../client/js/store", () => ({useStore: () => storeMock}));
vi.mock("../../../client/js/router", () => ({switchToChannel: vi.fn()}));
vi.mock("vue-router", () => ({
	useRouter: () => ({
		currentRoute: {value: {name: "Help"}},
		push: routerPush,
	}),
}));

import CommandPalette from "../../../client/components/CommandPalette.vue";

describe("CommandPalette", function () {
	it("exposes dialog/combobox state and routes to chat before prefilling a command", async function () {
		const previous = document.createElement("button");
		document.body.append(previous);
		previous.focus();
		const wrapper = mount(CommandPalette, {attachTo: document.body});

		expect(wrapper.get("[role='dialog']").attributes("aria-modal")).to.equal("true");
		expect(wrapper.get("[role='combobox']").attributes("aria-controls")).to.equal(
			"command-palette-results"
		);

		await (wrapper.vm as any).select({
			kind: "command",
			title: "/join",
			command: "/join",
		});

		expect(routerPush).toHaveBeenCalledWith({name: "RoutedChat", params: {id: 42}});
		expect(eventEmit).toHaveBeenCalledWith("chatinput:prefill", {text: "/join "});
		expect(wrapper.emitted("close")).toHaveLength(1);

		wrapper.unmount();
		expect(document.activeElement).to.equal(previous);
		previous.remove();
	});
});
