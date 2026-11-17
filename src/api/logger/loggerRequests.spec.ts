import { deserialize } from "@tsed/json-mapper";
import { getJsonSchema } from "@tsed/schema";
import { describe, expect, it } from "vitest";
import { LoggerIngestionPolicyRequest, LoggerRetentionRequest } from "./loggerRequests.js";

describe("logger retention request", () => {
	it("keeps optional severity overrides in the request schema and mapper", () => {
		const request = deserialize({ enabled: true, days: 14, severityDays: { error: 30, trace: 2 } }, { type: LoggerRetentionRequest });
		expect(request.severityDays).toMatchObject({ error: 30, trace: 2 });
		expect(getJsonSchema(LoggerRetentionRequest)).toMatchObject({
			properties: { severityDays: expect.any(Object) },
		});

	});
});

describe("logger ingestion request", () => {
	it("keeps credential limits in the request schema and mapper", () => {
		const request = deserialize({ eventsPerSecond: 500, burst: 1000, credentialEventsPerSecond: 10, credentialBurst: 1000, serviceEventsPerSecond: 20, serviceBurst: 1000 }, { type: LoggerIngestionPolicyRequest });
		expect(request).toMatchObject({ credentialEventsPerSecond: 10, credentialBurst: 1000, serviceEventsPerSecond: 20, serviceBurst: 1000 });
		expect(getJsonSchema(LoggerIngestionPolicyRequest)).toMatchObject({
			properties: { credentialEventsPerSecond: expect.any(Object), credentialBurst: expect.any(Object), serviceEventsPerSecond: expect.any(Object), serviceBurst: expect.any(Object) },
		});
	});
});
