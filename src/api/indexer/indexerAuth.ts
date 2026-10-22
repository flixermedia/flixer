import { Unauthorized } from "@tsed/exceptions";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const INDEXER_TIMESTAMP_HEADER = "x-indexer-timestamp";
export const INDEXER_SIGNATURE_HEADER = "x-indexer-signature";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Requests between flixer and flixer-indexer, in both directions, carry the headers above. The signature is
 * hex(HMAC-SHA256(secret, `flixer-indexer:v1:${timestamp}:${METHOD}:${path}:${hex(sha256(body))}`)).
 */
export function indexerSignature(secret: string, timestamp: string, method: string, path: string, body: Uint8Array): string {
	const bodyHash = createHash("sha256").update(body).digest("hex");
	return createHmac("sha256", secret).update(`flixer-indexer:v1:${timestamp}:${method.toUpperCase()}:${path}:${bodyHash}`).digest("hex");
}

export function indexerSecret(): string {
	const secret = process.env.STREAM_TOKEN_SECRET?.trim() ?? "";
	if (Buffer.byteLength(secret) < 32) {
		throw new Error("STREAM_TOKEN_SECRET must be set to at least 32 bytes to talk to flixer-indexer.");
	}
	return secret;
}

/** Headers for a request flixer sends to the indexer. */
export function signIndexerRequest(method: string, path: string, body: Uint8Array, now = Date.now()): Record<string, string> {
	const timestamp = Math.floor(now / 1000).toString();
	return {
		[INDEXER_TIMESTAMP_HEADER]: timestamp,
		[INDEXER_SIGNATURE_HEADER]: indexerSignature(indexerSecret(), timestamp, method, path, body),
	};
}

/** Throws Unauthorized unless the request was signed by the indexer with the shared secret. */
export function verifyIndexerRequest(
	request: { method: string; path: string; body: Uint8Array; timestamp?: string; signature?: string },
	now = Date.now(),
): void {
	let secret: string;
	try {
		secret = indexerSecret();
	} catch {
		throw new Unauthorized("Invalid indexer signature.");
	}
	const issuedAt = Number(request.timestamp);
	if (!request.signature || !Number.isInteger(issuedAt)) {
		throw new Unauthorized("Invalid indexer signature.");
	}
	if (Math.abs(now / 1000 - issuedAt) > MAX_CLOCK_SKEW_SECONDS) {
		throw new Unauthorized("Indexer signature has expired.");
	}

	const expected = Buffer.from(indexerSignature(secret, String(issuedAt), request.method, request.path, request.body), "hex");
	const provided = Buffer.from(request.signature, "hex");
	if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
		throw new Unauthorized("Invalid indexer signature.");
	}
}
