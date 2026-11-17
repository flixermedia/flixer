import { afterEach, describe, expect, it } from "vitest";
import { indexerSignature, signIndexerRequest, verifyIndexerRequest } from "./indexerAuth.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const BODY = Buffer.from('{"a":1}');

describe("indexerAuth", () => {
	const original = process.env.APP_SECRET;
	afterEach(() => {
		process.env.APP_SECRET = original;
	});

	it("matches the signature flixer-indexer (Go) produces", () => {
		expect(indexerSignature(SECRET, "1700000000", "POST", "/api/indexer/media/items", BODY)).toBe(
			"90b96a8c36e04cf03e03605f76454a0c72c37fe75836a93d0c9811955381bacd",
		);
	});

	it("accepts a request signed with the shared secret and rejects tampering", () => {
		process.env.APP_SECRET = SECRET;
		const now = Date.now();
		const headers = signIndexerRequest("POST", "/api/indexer/media/items", BODY, now);
		const request = {
			method: "POST",
			path: "/api/indexer/media/items",
			body: BODY,
			timestamp: headers["x-indexer-timestamp"],
			signature: headers["x-indexer-signature"],
		};
		expect(() => verifyIndexerRequest(request, now)).not.toThrow();
		expect(() => verifyIndexerRequest({ ...request, body: Buffer.from("{}") }, now)).toThrow();
		expect(() => verifyIndexerRequest(request, now + 10 * 60 * 1000)).toThrow();
	});
});
