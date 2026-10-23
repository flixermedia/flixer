import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const CONTEXT = Buffer.from("flixer:config-store:v1");

/**
 * Encrypts secrets stored in the config database with AES-256-GCM. The key is generated on first start and kept in a
 * 0600 file next to the database, so no extra setting is needed. Anyone who can read that volume can read the secrets,
 * which is the same protection a .env file gives; it keeps them out of backups of the database file alone and out of logs.
 */
export class SecretBox {

	private readonly key: Buffer;

	constructor(keyPath: string) {
		this.key = SecretBox.loadOrCreateKey(keyPath);
	}

	private static loadOrCreateKey(keyPath: string): Buffer {
		if (existsSync(keyPath)) {
			const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64url");
			if (key.length !== KEY_BYTES) {
				throw new Error(`The config encryption key at ${keyPath} is corrupted. Restore it from a backup; generating a new one would make saved secrets unreadable.`);
			}
			return key;
		}
		mkdirSync(dirname(keyPath), { recursive: true });
		const key = randomBytes(KEY_BYTES);
		// The exclusive flag stops two processes starting together from overwriting each other's key.
		try {
			writeFileSync(keyPath, key.toString("base64url"), { mode: 0o600, flag: "wx" });
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				return SecretBox.loadOrCreateKey(keyPath);
			}
			throw error;
		}
		chmodSync(keyPath, 0o600);
		return key;
	}

	encrypt(plain: string): string {
		const nonce = randomBytes(NONCE_BYTES);
		const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
		cipher.setAAD(CONTEXT);
		const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
		return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
	}

	decrypt(encrypted: string): string {
		const raw = Buffer.from(encrypted, "base64url");
		if (raw.length < NONCE_BYTES + TAG_BYTES) {
			throw new Error("A saved configuration secret is corrupted.");
		}
		const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, NONCE_BYTES));
		decipher.setAAD(CONTEXT);
		decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
		return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
	}

}
