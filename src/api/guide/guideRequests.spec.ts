import { compile } from "@tsed/schema";
import { describe, expect, it } from "vitest";
import { GuideChannelChange } from "./guideRequests.js";

describe("GuideChannelChange", () => {
	it("allows an IPTV mapping to be cleared", () => {
		const schema = compile(GuideChannelChange);
		const mappingSchema = schema.properties.iptvChannelId;

		expect(mappingSchema).toEqual({ type: ["null", "string"], format: "uuid" });
	});
});
