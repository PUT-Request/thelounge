// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {beforeEach, expect, vi} from "vitest";

const {socketListeners, socketMock} = vi.hoisted(() => {
	const listeners = new Map<string, (...args: any[]) => void>();
	return {
		socketListeners: listeners,
		socketMock: {
			connected: false,
			emit: vi.fn(),
			connect: vi.fn(),
			disconnect: vi.fn(),
			on: vi.fn(),
			once: vi.fn((event: string, callback: (...args: any[]) => void) => {
				listeners.set(event, callback);
			}),
			off: vi.fn((event: string, callback: (...args: any[]) => void) => {
				if (listeners.get(event) === callback) {
					listeners.delete(event);
				}
			}),
		},
	};
});

vi.mock("../../../client/js/socket", () => ({
	default: socketMock,
	tryAgainMessage: "Try again later",
}));

import SignIn from "../../../client/components/Windows/SignIn.vue";
import {store} from "../../../client/js/store";

describe("SignIn authentication retry", function () {
	beforeEach(function () {
		socketListeners.clear();
		vi.clearAllMocks();
		socketMock.connected = false;
		store.commit("authFailure", "failed");
	});

	it("reconnects and waits for auth:start before sending credentials", async function () {
		const wrapper = mount(SignIn);
		await wrapper.get("#signin-username").setValue("alice");
		await wrapper.get("#signin-password").setValue("correct horse");
		await wrapper.get("form").trigger("submit");

		expect(socketMock.disconnect).toHaveBeenCalledOnce();
		expect(socketMock.connect).toHaveBeenCalledOnce();
		expect(socketMock.emit).not.toHaveBeenCalledWith("auth:perform", expect.anything());

		socketListeners.get("auth:start")?.();
		expect(socketMock.emit).toHaveBeenCalledWith("auth:perform", {
			user: "alice",
			password: "correct horse",
		});

		wrapper.unmount();
	});

	it("replaces a stale retry listener instead of submitting twice", async function () {
		const wrapper = mount(SignIn);
		await wrapper.get("#signin-username").setValue("alice");
		await wrapper.get("#signin-password").setValue("first");
		await wrapper.get("form").trigger("submit");
		const firstRetry = socketListeners.get("auth:start");

		await wrapper.get("#signin-password").setValue("second");
		await wrapper.get("form").trigger("submit");
		const secondRetry = socketListeners.get("auth:start");

		expect(secondRetry).not.to.equal(firstRetry);
		secondRetry?.();
		expect(socketMock.emit).toHaveBeenCalledTimes(1);
		expect(socketMock.emit).toHaveBeenCalledWith("auth:perform", {
			user: "alice",
			password: "second",
		});

		wrapper.unmount();
	});
});
