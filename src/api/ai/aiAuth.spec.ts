import { Unauthorized } from "@tsed/exceptions";
import { afterEach, describe, expect, it } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { aiSignature, canonicalAiJson, verifyAiRequest } from "./aiAuth.js";

const originalSecret = process.env.APP_SECRET;
const secret = "test-shared-secret-with-at-least-32-bytes";
const path = "/api/internal/ai/library-context";
const body = new Uint8Array();

describe("AI internal request authentication", () => {
	afterEach(() => {
		if (originalSecret === undefined) {
			delete process.env.APP_SECRET;
		} else {
			process.env.APP_SECRET = originalSecret;
		}
		setAppConfig(undefined);
	});

	it("accepts a correctly signed request", () => {
		process.env.APP_SECRET = secret;
		setAppConfig(new AppConfig(null));
		const timestamp = "1700000000";
		const signature = aiSignature(secret, timestamp, "get", path, body);

		expect(() => verifyAiRequest({ method: "GET", path, body, timestamp, signature }, 1_700_000_000_000)).not.toThrow();
	});

	it("canonicalizes signed JSON cache payloads consistently", () => {
		const body = canonicalAiJson({
			lastRefreshAt: null,
			entries: {
				["a".repeat(64)]: { items: [{ score: 0.8, id: "café" }] },
			},
		});

		expect(body.toString()).toBe(`{"entries":{"${"a".repeat(64)}":{"items":[{"id":"café","score":0.8}]}},"lastRefreshAt":null}`);
	});

	it("rejects tampered, malformed, and expired signatures", () => {
		process.env.APP_SECRET = secret;
		setAppConfig(new AppConfig(null));
		const timestamp = "1700000000";
		const signature = aiSignature(secret, timestamp, "GET", path, body);

		expect(() => verifyAiRequest({ method: "GET", path, body, timestamp, signature: `${signature.slice(0, -1)}0` }, 1_700_000_000_000)).toThrow(Unauthorized);
		expect(() => verifyAiRequest({ method: "GET", path, body, timestamp: "not-a-time", signature }, 1_700_000_000_000)).toThrow(Unauthorized);
		expect(() => verifyAiRequest({ method: "GET", path, body, timestamp, signature }, 1_700_000_600_000)).toThrow(Unauthorized);
	});

	it("rejects requests when the shared secret is unavailable", () => {
		delete process.env.APP_SECRET;
		setAppConfig(new AppConfig(null));

		expect(() => verifyAiRequest({ method: "GET", path, body, timestamp: "1700000000", signature: "a".repeat(64) }, 1_700_000_000_000)).toThrow(Unauthorized);
	});
});
