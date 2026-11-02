import { Unauthorized } from "@tsed/exceptions";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";

export const AI_TIMESTAMP_HEADER = "x-flixer-ai-timestamp";
export const AI_SIGNATURE_HEADER = "x-flixer-ai-signature";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function aiSignature(secret: string, timestamp: string, method: string, path: string, body: Uint8Array): string {
	const bodyHash = createHash("sha256").update(body).digest("hex");
	return createHmac("sha256", secret).update(`flixer-ai:v1:${timestamp}:${method.toUpperCase()}:${path}:${bodyHash}`).digest("hex");
}

export function canonicalAiJson(value: unknown): Uint8Array {
	if (value === null || typeof value !== "object") {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) throw new Error("Cannot sign an undefined AI request body.");
		return Buffer.from(serialized);
	}
	if (Array.isArray(value)) {
		return Buffer.from(`[${value.map((entry) => canonicalAiJson(entry).toString()).join(",")}]`);
	}
	const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return Buffer.from(`{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalAiJson(entry).toString()}`).join(",")}}`);
}

function aiSecret(): string {
	const secret = appConfig().get("appSecret") ?? "";
	if (Buffer.byteLength(secret) < 32) {
		throw new Error("APP_SECRET must be set to at least 32 bytes to talk to flixer-ai.");
	}
	return secret;
}

export function verifyAiRequest(
	request: {
		method: string;
		path: string;
		body: Uint8Array;
		timestamp?: string;
		signature?: string;
	},
	now = Date.now(),
): void {
	let secret: string;
	try {
		secret = aiSecret();
	} catch {
		throw new Unauthorized("Invalid flixer-ai signature.");
	}

	const issuedAt = Number(request.timestamp);
	if (!request.signature || !Number.isInteger(issuedAt)) {
		throw new Unauthorized("Invalid flixer-ai signature.");
	}
	if (Math.abs(now / 1000 - issuedAt) > MAX_CLOCK_SKEW_SECONDS) {
		throw new Unauthorized("Flixer-ai signature has expired.");
	}

	const expected = Buffer.from(aiSignature(secret, String(issuedAt), request.method, request.path, request.body), "hex");
	const provided = Buffer.from(request.signature, "hex");
	if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
		throw new Unauthorized("Invalid flixer-ai signature.");
	}
}
