import { getJsonSchema } from "@tsed/schema";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { QuickConnectDecisionRequest } from "./quickConnectRequest.js";

describe("QuickConnectDecisionRequest", () => {
	const validate = new Ajv().compile(getJsonSchema(QuickConnectDecisionRequest));

	it.each(["23456789", "ABCDEFGH", "JKLMNPQR", "STUVWXYZ", "2abc-2345", "2ABC-2345"])("accepts a valid code: %s", (userCode) => {
		expect(validate({ userCode }), JSON.stringify(validate.errors)).toBe(true);
	});

	it.each(["12345678", "I2345678", "O2345678", "234-56789", "2345678", "234567890", "2ABC_2345", "2ABC-2345\n"])("rejects an invalid code: %s", (userCode) => {
		expect(validate({ userCode })).toBe(false);
	});

	it("requires a code", () => {
		expect(validate({})).toBe(false);
	});
});
