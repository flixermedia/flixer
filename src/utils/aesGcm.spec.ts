import { describe, expect, it } from "vitest";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "./aesGcm.js";

const SECRET = "x".repeat(32);

describe("aesGcm", () => {
	it("round-trips a value", () => {
		const key = deriveAesKey(SECRET, "ctx", "too short");
		const sealed = aesGcmEncrypt("hello", key, Buffer.from("ctx"));
		expect(aesGcmDecrypt(sealed, key, Buffer.from("ctx"), "corrupt")).toBe("hello");
	});

	it("rejects a different AAD or context key", () => {
		const key = deriveAesKey(SECRET, "ctx", "too short");
		const sealed = aesGcmEncrypt("hello", key, Buffer.from("a"));
		expect(() => aesGcmDecrypt(sealed, key, Buffer.from("b"), "corrupt")).toThrow();
		expect(() => aesGcmDecrypt(sealed, deriveAesKey(SECRET, "other", "x"), Buffer.from("a"), "corrupt")).toThrow();
	});

	it("rejects short secrets and truncated payloads", () => {
		expect(() => deriveAesKey("short", "ctx", "too short")).toThrow("too short");
		const key = deriveAesKey(SECRET, "ctx", "too short");
		expect(() => aesGcmDecrypt("AAAA", key, Buffer.from("ctx"), "corrupt")).toThrow("corrupt");
	});
});
