import { createHash, createPublicKey, randomBytes, verify as verifyDetached } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";
import type { CloudAccount, CloudPlan } from "./cloudTypes.js";

const CONTEXT = "flixer:cloud:v1";
const AAD = Buffer.from(CONTEXT);
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export const PINNED_CLOUD_PUBLIC_KEY_PEM = [
	"-----BEGIN PUBLIC KEY-----",
	"MCowBQYDK2VwAyEAuKrvT9RXClZX2qOt7mnC5pSon2fOBKXeInN4JYz8ers=",
	"-----END PUBLIC KEY-----",
].join("\n");

export const PINNED_CLOUD_PUBLIC_KEYS: Record<string, string> = {
	v1: PINNED_CLOUD_PUBLIC_KEY_PEM,
};

function key(): Buffer {
	return deriveAesKey(appConfig().require("appSecret"), CONTEXT, "APP_SECRET must be at least 32 bytes to store Flixer Cloud credentials.");
}

export function encryptCloudSecret(value: string): string {
	return aesGcmEncrypt(value, key(), AAD);
}

export function decryptCloudSecret(value: string): string {
	return aesGcmDecrypt(value, key(), AAD, "Stored Flixer Cloud credentials are corrupted.");
}

export interface CloudOAuthStatePayload {
	v: string;
	r: string;
	e: number;
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	return { codeVerifier, codeChallenge };
}

export function sealCloudOAuthState(codeVerifier: string, redirectUri: string, now = Date.now()): string {
	const payload: CloudOAuthStatePayload = {
		v: codeVerifier,
		r: redirectUri,
		e: now + OAUTH_STATE_TTL_MS,
	};
	return encryptCloudSecret(JSON.stringify(payload));
}

export function unsealCloudOAuthState(state: string, now = Date.now()): CloudOAuthStatePayload | null {
	try {
		const raw = decryptCloudSecret(state);
		const parsed = JSON.parse(raw) as Partial<CloudOAuthStatePayload>;
		if (
			typeof parsed.v !== "string"
			|| typeof parsed.r !== "string"
			|| typeof parsed.e !== "number"
			|| parsed.e < now
		) {
			return null;
		}
		return { v: parsed.v, r: parsed.r, e: parsed.e };
	} catch {
		return null;
	}
}

export interface VerifiedEntitlementsPayload {
	iss: string;
	aud: string;
	sub: string;
	linkId: string;
	serverInstanceId: string | null;
	account: CloudAccount;
	plans: CloudPlan[];
	features?: string[];
	syncedAt: string;
	iat: number;
	exp: number;
}

export function verifyEntitlementsToken(
	token: string,
	expected: {
		linkId?: string | null;
		instanceId?: string | null;
		publicKeyPem?: string;
		nowSeconds?: number;
	} = {},
): VerifiedEntitlementsPayload {
	if (typeof token !== "string" || !token) {
		throw new Error("Missing Flixer Cloud entitlement signature.");
	}
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Malformed Flixer Cloud entitlement token.");
	}
	const [headerB64, payloadB64, signatureB64] = parts;
	let header: { alg?: unknown; kid?: unknown };
	try {
		header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as { alg?: unknown; kid?: unknown };
	} catch {
		throw new Error("Invalid Flixer Cloud entitlement token header.");
	}
	if (header.alg !== "EdDSA") {
		throw new Error("Unsupported Flixer Cloud entitlement signature algorithm.");
	}

	let pem = expected.publicKeyPem;
	if (!pem) {
		if (typeof header.kid === "string") {
			pem = PINNED_CLOUD_PUBLIC_KEYS[header.kid];
			if (!pem) {
				throw new Error("Unknown Flixer Cloud signing key ID.");
			}
		} else {
			pem = PINNED_CLOUD_PUBLIC_KEY_PEM;
		}
	}

	const publicKey = createPublicKey(pem);
	const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
	const signature = Buffer.from(signatureB64, "base64url");
	if (!verifyDetached(null, signingInput, publicKey, signature)) {
		throw new Error("Flixer Cloud entitlement signature verification failed.");
	}

	let payload: Partial<VerifiedEntitlementsPayload>;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Partial<VerifiedEntitlementsPayload>;
	} catch {
		throw new Error("Invalid Flixer Cloud entitlement payload.");
	}

	const nowSeconds = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
	if (payload.iss !== "https://flixer.dev" || payload.aud !== "flixer-server") {
		throw new Error("Flixer Cloud entitlement token issuer/audience mismatch.");
	}
	if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
		throw new Error("Flixer Cloud entitlement token has expired.");
	}
	if (expected.linkId && payload.linkId !== expected.linkId) {
		throw new Error("Flixer Cloud entitlement token linkId mismatch.");
	}
	if (expected.instanceId && payload.serverInstanceId && payload.serverInstanceId !== expected.instanceId) {
		throw new Error("Flixer Cloud entitlement token does not belong to this server instance.");
	}
	if (!payload.account || !Array.isArray(payload.plans) || typeof payload.syncedAt !== "string") {
		throw new Error("Flixer Cloud entitlement payload is incomplete.");
	}

	return payload as VerifiedEntitlementsPayload;
}
