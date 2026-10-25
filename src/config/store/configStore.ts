import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { CONFIG_KEYS, type ConfigKeyDefinition, type ConfigName } from "./configSchema.js";
import { SecretBox } from "./secretBox.js";

/** not_started: nothing saved yet. in_progress: the wizard has begun. completed: never reset by an outage. recovery_required: needs an administrator. */
export const SETUP_STATES = ["not_started", "in_progress", "completed", "recovery_required"] as const;
export type SetupState = (typeof SETUP_STATES)[number];

export interface WizardProgress {
	flow: "quick" | "advanced";
	completedSteps: string[];
	/** The wizard was pointed at a database that already has accounts, so setup continues without creating an administrator. */
	adoptedAccounts?: boolean;
}

export type ConfigSource = "env" | "store" | "default" | "unset";

interface Migration {
	version: number;
	sql: string;
}

/** Append-only; never edit a shipped migration. */
const MIGRATIONS: Migration[] = [
	{
		version: 1,
		sql: `
			CREATE TABLE config (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				encrypted INTEGER NOT NULL DEFAULT 0,
				version INTEGER NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		`,
	},
];

export class ConfigValidationError extends Error {}

function definitionOf(name: ConfigName): ConfigKeyDefinition {
	return CONFIG_KEYS[name];
}

/** Persistent bootstrap configuration in SQLite. Values are read synchronously so it can be used before any service has started. */
export class ConfigStore {

	private readonly db: DatabaseSync;
	private readonly box: SecretBox;

	constructor(directory: string) {
		mkdirSync(directory, { recursive: true });
		this.db = new DatabaseSync(join(directory, "flixer-config.db"));
		this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
		this.box = new SecretBox(join(directory, "config.key"));
		this.migrate();
	}

	private migrate(): void {
		this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
		const applied = new Set((this.db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => row.version));
		for (const migration of MIGRATIONS) {
			if (applied.has(migration.version)) {
				continue;
			}
			this.db.exec("BEGIN IMMEDIATE");
			try {
				this.db.exec(migration.sql);
				this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
				this.db.exec("COMMIT");
			} catch (error: unknown) {
				this.db.exec("ROLLBACK");
				throw error;
			}
		}
	}

	/** Counts every saved change so other services can tell when to reload. */
	version(): number {
		const row = this.db.prepare("SELECT value FROM meta WHERE key = 'config_version'").get() as { value: string } | undefined;
		return row ? Number(row.value) : 0;
	}

	get(name: ConfigName): string | undefined {
		const row = this.db.prepare("SELECT value, encrypted FROM config WHERE key = ?").get(definitionOf(name).key) as { value: string; encrypted: number } | undefined;
		if (!row) {
			return undefined;
		}
		return row.encrypted ? this.box.decrypt(row.value) : row.value;
	}

	has(name: ConfigName): boolean {
		return this.db.prepare("SELECT 1 FROM config WHERE key = ?").get(definitionOf(name).key) !== undefined;
	}

	/** Saves values atomically after validating all of them; nothing is written if one is invalid. */
	setMany(values: Partial<Record<ConfigName, string>>): number {
		const entries = Object.entries(values) as [ConfigName, string][];
		const errors: string[] = [];
		for (const [name, value] of entries) {
			const problem = definitionOf(name).validate?.(value);
			if (problem) {
				errors.push(`${name}: ${problem}`);
			}
		}
		if (errors.length > 0) {
			throw new ConfigValidationError(errors.join(" "));
		}

		this.db.exec("BEGIN IMMEDIATE");
		try {
			const next = this.version() + 1;
			const now = new Date().toISOString();
			const upsert = this.db.prepare(
				"INSERT INTO config (key, value, encrypted, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, version = excluded.version, updated_at = excluded.updated_at",
			);
			for (const [name, value] of entries) {
				const definition = definitionOf(name);
				upsert.run(definition.key, definition.secret ? this.box.encrypt(value) : value, definition.secret ? 1 : 0, next, now);
			}
			this.db.prepare("INSERT INTO meta (key, value) VALUES ('config_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(next));
			this.db.exec("COMMIT");
			return next;
		} catch (error: unknown) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	setupState(): SetupState {
		const row = this.db.prepare("SELECT value FROM meta WHERE key = 'setup_state'").get() as { value: string } | undefined;
		return SETUP_STATES.find((state) => state === row?.value) ?? "not_started";
	}

	/** A completed installation only leaves that state through reset(), never by a plain write. */
	setSetupState(state: SetupState): void {
		if (this.setupState() === "completed" && state !== "completed") {
			throw new Error("Setup is already completed. Use an administrator reset to run it again.");
		}
		this.writeSetupState(state);
	}

	/** Which wizard flow was chosen and which steps are done, so a refresh or a second browser resumes where setup stopped. */
	wizardProgress(): WizardProgress {
		const row = this.db.prepare("SELECT value FROM meta WHERE key = 'wizard_progress'").get() as { value: string } | undefined;
		try {
			const parsed = JSON.parse(row?.value ?? "") as Partial<WizardProgress>;
			const flow = parsed.flow === "advanced" ? "advanced" : "quick";
			const steps = Array.isArray(parsed.completedSteps) ? parsed.completedSteps.filter((step): step is string => typeof step === "string") : [];
			return { flow, completedSteps: [...new Set(steps)], ...(parsed.adoptedAccounts === true ? { adoptedAccounts: true } : {}) };
		} catch {
			return { flow: "quick", completedSteps: [] };
		}
	}

	setWizardProgress(progress: WizardProgress): void {
		this.db.prepare("INSERT INTO meta (key, value) VALUES ('wizard_progress', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(progress));
	}

	/** Reopens the wizard. Saved values stay, so the steps come back pre-filled. */
	reset(): void {
		this.writeSetupState("not_started");
		this.db.prepare("DELETE FROM meta WHERE key = 'wizard_progress'").run();
	}

	private writeSetupState(state: SetupState): void {
		this.db.prepare("INSERT INTO meta (key, value) VALUES ('setup_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(state);
	}

	/** Writes a consistent, WAL-free copy of the database to `destination`, which must not exist yet. */
	snapshot(destination: string): void {
		this.db.prepare("VACUUM INTO ?").run(destination);
	}

	close(): void {
		this.db.close();
	}

}
