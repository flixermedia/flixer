import { describe, expect, it } from "vitest";
import { LoginThrottle } from "./loginThrottle.js";
import { DEFAULT_LOGIN_SECURITY } from "./loginSecurity.js";

describe("LoginThrottle", () => {
	it("limits each normalized username across different addresses and expires its window", () => {
		const throttle = new LoginThrottle();
		for (let index = 0; index < 10; index++) {
			expect(throttle.reserve(`ip-${index}`, "user", 1_000)).toEqual(expect.any(Function));
		}
		expect(throttle.reserve("new-ip", "user", 1_000)).toBe(60);
		expect(throttle.reserve("new-ip", "another", 1_000)).toEqual(expect.any(Function));
		expect(throttle.reserve("new-ip", "user", 61_000)).toEqual(expect.any(Function));
	});

	it("limits each address across different usernames and permits other addresses", () => {
		const throttle = new LoginThrottle();
		for (let index = 0; index < 20; index++) {
			expect(throttle.reserve("ip", `user-${index}`, 1_000)).toEqual(expect.any(Function));
		}
		expect(throttle.reserve("ip", "another", 1_000)).toBe(60);
		expect(throttle.reserve("other-ip", "another", 1_000)).toEqual(expect.any(Function));
	});

	it("releases only a successful attempt without clearing other failures", () => {
		const throttle = new LoginThrottle();
		for (let index = 0; index < 9; index++) throttle.reserve("ip", "user", 1_000);
		const successful = throttle.reserve("ip", "user", 1_000);
		expect(successful).toEqual(expect.any(Function));
		if (typeof successful === "function") {
			successful();
			successful();
		}
		expect(throttle.reserve("other-ip", "user", 1_000)).toEqual(expect.any(Function));
		expect(throttle.reserve("other-ip", "user", 1_000)).toBe(60);
	});

	it("does not fill username buckets with requests from an already blocked address", () => {
		const throttle = new LoginThrottle();
		for (let index = 0; index < 20; index++) throttle.reserve("blocked-ip", `user-${index}`, 1_000);
		for (let index = 0; index < 10_000; index++) throttle.reserve("blocked-ip", `spray-${index}`, 1_000);
		expect(throttle.reserve("other-ip", "new-user", 1_000)).toEqual(expect.any(Function));
	});

	it("applies configured limits and window", () => {
		const throttle = new LoginThrottle();
		const config = { ...DEFAULT_LOGIN_SECURITY, ipLimit: 2, usernameLimit: 1, windowSeconds: 10 };
		expect(throttle.reserve("ip", "first", 1_000, config)).toEqual(expect.any(Function));
		expect(throttle.reserve("other", "first", 1_000, config)).toBe(10);
		expect(throttle.reserve("ip", "second", 1_000, config)).toEqual(expect.any(Function));
		expect(throttle.reserve("ip", "third", 1_000, config)).toBe(10);
		expect(throttle.reserve("ip", "third", 11_000, config)).toEqual(expect.any(Function));
	});
});