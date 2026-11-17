import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOGIN_SECURITY, getLoginSecurity, setLoginSecurity, validateLoginSecurity } from "./loginSecurity.js";

describe("login security settings", () => {
	afterEach(() => setLoginSecurity(DEFAULT_LOGIN_SECURITY));

	it("accepts independent settings and tracks changes", () => {
		const before = getLoginSecurity().revision;
		setLoginSecurity({ ...DEFAULT_LOGIN_SECURITY, timingEnabled: false, throttleEnabled: false, ipLimit: 5 });
		expect(getLoginSecurity()).toMatchObject({ revision: before + 1, config: { timingEnabled: false, throttleEnabled: false, ipLimit: 5 } });
	});

	it.each([{ minimumMs: 0 }, { minimumMs: 5001 }, { jitterMs: -1 }, { ipLimit: 0 }, { usernameLimit: 1.5 }, { windowSeconds: 9 }, { timingEnabled: "false" }])("rejects unsafe or invalid values %o", (invalid) => {
		expect(() => validateLoginSecurity({ ...DEFAULT_LOGIN_SECURITY, ...invalid })).toThrow();
	});
});
