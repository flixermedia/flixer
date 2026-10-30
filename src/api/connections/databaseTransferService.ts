import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Injectable, logger } from "@tsed/di";
import { Conflict, BadRequest } from "@tsed/exceptions";
import pg from "pg";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { appConfig } from "../../config/store/appConfig.js";
import type { DatabaseTransferJournal } from "../../config/store/configStore.js";
import { validatePostgresUrl } from "../../config/store/configSchema.js";

type TransferState = "idle" | "running" | "failed" | "interrupted" | "completed";

export interface DatabaseTransferStatus {
	state: TransferState;
	phase: string;
	message: string;
	sourceLocked: boolean;
	startedAt: string | null;
	finishedAt: string | null;
	currentDatabaseUrl: string | null;
}

type DatabaseTransferState = Omit<DatabaseTransferStatus, "currentDatabaseUrl">;

const CONNECTION_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 15_000;

function urlParts(value: string): { host: string; port: string; database: string } {
	const url = new URL(value);
	return {
		host: url.hostname.toLowerCase(),
		port: url.port || "5432",
		database: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
	};
}

function sameDatabase(left: string, right: string): boolean {
	const source = urlParts(left);
	const target = urlParts(right);
	return source.host === target.host && source.port === target.port && source.database === target.database;
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

export function redactDatabaseUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.password) url.password = "[redacted]";
		for (const key of url.searchParams.keys()) {
			if (["password", "pass", "pwd"].includes(key.toLowerCase())) {
				url.searchParams.set(key, "[redacted]");
			}
		}
		return url.toString();
	} catch {
		return null;
	}
}

interface TargetSchema {
	name: string;
	owner: string;
}

interface TargetReplacementPlan {
	currentUser: string;
	schemasToDrop: string[];
	publicSchemaOwned: boolean;
}

export function replaceableSchemas(schemas: TargetSchema[], currentUser: string): string[] {
	return schemas.filter(({ name, owner }) => name !== "public" && owner === currentUser).map(({ name }) => name);
}

async function targetReplacementPlan(client: pg.Client): Promise<TargetReplacementPlan> {
	const userResult = await client.query<{ currentUser: string }>('SELECT current_user AS "currentUser"');
	const currentUser = userResult.rows[0]?.currentUser;
	if (!currentUser) throw new Error("Could not identify the target database user.");

	const schemaResult = await client.query<TargetSchema>(
		`SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner
		FROM pg_namespace
		WHERE nspname <> 'information_schema'
			AND left(nspname, 3) <> 'pg_'
		ORDER BY nspname`,
	);
	const publicSchema = schemaResult.rows.find(({ name }) => name === "public");
	const publicSchemaOwned = publicSchema?.owner === currentUser;
	if (!publicSchemaOwned) {
		const publicObjects = await client.query<{ hasObjects: boolean }>(`
			SELECT (
				EXISTS (
					SELECT 1 FROM pg_class c
					JOIN pg_namespace n ON n.oid = c.relnamespace
					WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
				)
				OR EXISTS (
					SELECT 1 FROM pg_proc p
					JOIN pg_namespace n ON n.oid = p.pronamespace
					WHERE n.nspname = 'public'
				)
			) AS "hasObjects"
		`);
		if (publicObjects.rows[0]?.hasObjects) {
			throw new Conflict(
				`Cannot replace objects in schema "public": it is owned by PostgreSQL role "${publicSchema?.owner ?? "another role"}", but the target connection uses "${currentUser}". Use the schema owner’s connection or clear its application objects before transferring.`,
			);
		}
		if (publicSchema) {
			const canCreate = await client.query<{ allowed: boolean }>(
				"SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS allowed",
			);
			if (canCreate.rows[0]?.allowed !== true) {
				throw new Conflict(
					`The target role "${currentUser}" cannot create objects in schema "public". Grant it CREATE permission or use a role with access to that schema.`,
				);
			}
		}
	}

	return {
		currentUser,
		schemasToDrop: replaceableSchemas(schemaResult.rows, currentUser),
		publicSchemaOwned,
	};
}

function clientFor(url: string): pg.Client {
	const client = new pg.Client({
		connectionString: url,
		connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
		query_timeout: QUERY_TIMEOUT_MS,
	});
	client.on("error", () => undefined);
	return client;
}

function databaseName(url: string): string {
	return urlParts(url).database;
}

function connectionEnvironment(connectionUrl: string): NodeJS.ProcessEnv {
	const url = new URL(connectionUrl);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PGHOST: url.hostname,
		PGPORT: url.port || "5432",
		PGUSER: decodeURIComponent(url.username),
		PGPASSWORD: decodeURIComponent(url.password),
		PGDATABASE: databaseName(connectionUrl),
	};
	const libpqOptions: Record<string, string> = {
		sslmode: "PGSSLMODE",
		sslrootcert: "PGSSLROOTCERT",
		sslcert: "PGSSLCERT",
		sslkey: "PGSSLKEY",
	};
	for (const [parameter, variable] of Object.entries(libpqOptions)) {
		const value = url.searchParams.get(parameter);
		if (value) env[variable] = value;
	}
	return env;
}

function redact(message: string, connectionUrls: string[]): string {
	let output = message;
	for (const connectionUrl of connectionUrls) {
		try {
			const url = new URL(connectionUrl);
			for (const value of [url.password, decodeURIComponent(url.password), connectionUrl]) {
				if (value) output = output.split(value).join("[redacted]");
			}
		} catch {
			continue;
		}
	}
	return output.replace(/\s+/g, " ").trim();
}

function childExit(child: ChildProcessWithoutNullStreams, name: string, urls: string[]): Promise<void> {
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		if (stderr.length < 2000) stderr += chunk.toString();
	});
	return new Promise((resolve, reject) => {
		child.once("error", (error: NodeJS.ErrnoException) => {
			reject(
				new Error(
					error.code === "ENOENT"
						? `${name} is not installed in the API container.`
						: `${name}: ${redact(error.message, urls)}`,
				),
			);
		});
		child.once("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${name} failed (exit ${code}): ${redact(stderr, urls) || "No details provided."}`));
		});
	});
}

@Injectable()
export class DatabaseTransferService {
	private state: DatabaseTransferState = {
		state: "idle",
		phase: "",
		message: "",
		sourceLocked: false,
		startedAt: null,
		finishedAt: null,
	};
	private running = false;

	constructor() {
		const journal = appConfig().persistent?.getDatabaseTransferJournal();
		if (!journal) return;
		const interrupted = journal.state === "running";
		if (interrupted) {
			journal.state = "failed";
			journal.phase = "interrupted";
			journal.message =
				"The API restarted during transfer. The source database may still be read-only; restore writes or restart the transfer.";
			journal.finishedAt = new Date().toISOString();
			appConfig().persistent?.setDatabaseTransferJournal(journal);
		}
		this.state = {
			state: interrupted ? "interrupted" : journal.state,
			phase: journal.phase,
			message: journal.message,
			sourceLocked: journal.sourceLocked,
			startedAt: journal.startedAt,
			finishedAt: journal.finishedAt,
		};
	}

	status(): DatabaseTransferStatus {
		return {
			...this.state,
			currentDatabaseUrl: redactDatabaseUrl(appConfig().get("databaseUrl")),
		};
	}

	start(targetUrl: string, replaceTarget = false): DatabaseTransferStatus {
		const validationError = validatePostgresUrl(targetUrl);
		if (validationError) throw new BadRequest(validationError);
		if (this.running || this.state.state === "running") {
			throw new Conflict("A database transfer is already running.");
		}
		if (this.state.state === "completed") {
			throw new Conflict("The database transfer is complete. Restart the API to switch to the new database.");
		}
		if (this.state.sourceLocked) {
			throw new Conflict(
				"The source database is still read-only. Restore writes before starting another transfer.",
			);
		}
		const config = appConfig();
		if (config.source("databaseUrl") === "env") {
			throw new Conflict(
				"DATABASE_URL is set by the environment and cannot be switched from the admin dashboard.",
			);
		}
		const sourceUrl = config.get("databaseUrl");
		if (!sourceUrl) throw new Conflict("The current PostgreSQL connection is not configured.");
		if (sameDatabase(sourceUrl, targetUrl)) {
			throw new BadRequest("The target must be a different PostgreSQL database.");
		}
		const journal: DatabaseTransferJournal = {
			id: randomUUID(),
			state: "running",
			phase: "Validating target",
			message: replaceTarget
				? "Checking that the target is reachable."
				: "Checking that the target is reachable and empty.",
			sourceUrl,
			targetUrl,
			replaceTarget,
			sourceWasReadOnly: false,
			sourceLocked: false,
			startedAt: new Date().toISOString(),
			finishedAt: null,
		};
		this.save(journal);
		this.running = true;
		void this.execute(journal)
			.catch((error: unknown) => {
				const message = redact(error instanceof Error ? error.message : String(error), [
					journal.sourceUrl,
					journal.targetUrl,
				]);
				this.state = {
					state: "failed",
					phase: journal.sourceLocked ? "restore-required" : "failed",
					message: `Transfer stopped unexpectedly: ${message}`,
					sourceLocked: journal.sourceLocked,
					startedAt: journal.startedAt,
					finishedAt: new Date().toISOString(),
				};
				try {
					journal.state = "failed";
					journal.phase = this.state.phase;
					journal.message = this.state.message;
					journal.finishedAt = this.state.finishedAt;
					this.save(journal);
				} catch (journalError) {
					logger().error("The interrupted database transfer state could not be saved.", journalError);
				}
				logger().error("The database transfer stopped unexpectedly.", new Error(message));
			})
			.finally(() => {
				this.running = false;
			});
		return this.status();
	}

	async restoreSourceWrites(): Promise<DatabaseTransferStatus> {
		if (this.running) throw new Conflict("Wait for the database transfer to finish before restoring writes.");
		const journal = appConfig().persistent?.getDatabaseTransferJournal();
		if (!journal?.sourceLocked) throw new Conflict("There is no transfer lock to remove.");
		if (journal.state === "completed") {
			throw new Conflict(
				"The transfer is complete. Restart the Flixer API to switch databases before considering a rollback.",
			);
		}
		await this.restoreSource(journal);
		journal.sourceLocked = false;
		journal.phase = "writes-restored";
		journal.message = journal.sourceWasReadOnly
			? "The source database was already read-only before transfer; its prior read-only setting was preserved."
			: "Writes are restored on the source database. You can try another empty target.";
		journal.state = "failed";
		journal.finishedAt = new Date().toISOString();
		this.save(journal);
		return this.status();
	}

	private save(journal: DatabaseTransferJournal): void {
		appConfig().persistent?.setDatabaseTransferJournal(journal);
		this.state = {
			state: journal.state,
			phase: journal.phase,
			message: journal.message,
			sourceLocked: journal.sourceLocked,
			startedAt: journal.startedAt,
			finishedAt: journal.finishedAt,
		};
	}

	private async execute(journal: DatabaseTransferJournal): Promise<void> {
		try {
			if (journal.replaceTarget) {
				await this.assertTargetReplaceable(journal.targetUrl);
			} else {
				await this.assertTargetEmpty(journal.targetUrl);
			}
			await this.lockSource(journal);
			journal.phase = "Copying database";
			journal.message = journal.replaceTarget
				? "Writes are frozen. Replacing the target contents with a copy of the source."
				: "Writes are frozen. Dumping the source and restoring it to the empty target.";
			this.save(journal);
			await this.copyDatabase(journal.sourceUrl, journal.targetUrl, journal.replaceTarget);
			journal.state = "completed";
			journal.phase = "Ready to switch";
			journal.message =
				"The full database was copied. The old database remains read-only; restart the Flixer API to use the new connection.";
			journal.finishedAt = new Date().toISOString();
			this.save(journal);
		} catch (error) {
			let unlockError: unknown;
			if (journal.sourceLocked) {
				try {
					await this.restoreSource(journal);
					journal.sourceLocked = false;
				} catch (restoreError) {
					unlockError = restoreError;
				}
			}
			journal.state = "failed";
			journal.phase = journal.sourceLocked ? "restore-required" : "failed";
			const transferError = redact(error instanceof Error ? error.message : String(error), [
				journal.sourceUrl,
				journal.targetUrl,
			]);
			journal.message = unlockError
				? `Transfer failed: ${transferError} Writes could not be restored: ${redact(unlockError instanceof Error ? unlockError.message : String(unlockError), [journal.sourceUrl, journal.targetUrl])}`
				: `Transfer failed and the source database is writable again: ${transferError}`;
			journal.finishedAt = new Date().toISOString();
			this.save(journal);
		}
	}

	private async assertTargetEmpty(targetUrl: string): Promise<void> {
		const client = clientFor(targetUrl);
		try {
			await client.connect();
			const result = await client.query<{ database: string; hasObjects: boolean }>(`
				SELECT current_database() AS database,
					(
						EXISTS (
							SELECT 1 FROM pg_namespace
							WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
								AND nspname NOT LIKE 'pg_toast%'
						)
						OR EXISTS (
							SELECT 1 FROM pg_class c
							JOIN pg_namespace n ON n.oid = c.relnamespace
							WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
						)
						OR EXISTS (
							SELECT 1 FROM pg_proc p
							JOIN pg_namespace n ON n.oid = p.pronamespace
							WHERE n.nspname = 'public'
						)
						OR EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
					) AS "hasObjects"
			`);
			if (result.rows[0]?.hasObjects) {
				throw new Conflict(
					"The target database contains objects. Choose an empty target or enable Replace target contents in the confirmation dialog.",
				);
			}
		} finally {
			await client.end().catch(() => undefined);
		}
	}

	private async assertTargetReplaceable(targetUrl: string): Promise<void> {
		const client = clientFor(targetUrl);
		try {
			await client.connect();
			await client.query("SELECT 1");
			await targetReplacementPlan(client);
		} finally {
			await client.end().catch(() => undefined);
		}
	}

	private async clearTarget(targetUrl: string): Promise<void> {
		const client = clientFor(targetUrl);
		try {
			await client.connect();
			const plan = await targetReplacementPlan(client);

			await client.query("BEGIN");
			try {
				for (const name of plan.schemasToDrop) {
					await client.query(`DROP SCHEMA ${quoteIdentifier(name)} CASCADE`);
				}
				if (plan.publicSchemaOwned) {
					await client.query("DROP SCHEMA public CASCADE");
					await client.query(`CREATE SCHEMA public AUTHORIZATION ${quoteIdentifier(plan.currentUser)}`);
				}
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
		} finally {
			await client.end().catch(() => undefined);
		}
	}

	private async lockSource(journal: DatabaseTransferJournal): Promise<void> {
		const client = clientFor(journal.sourceUrl);
		try {
			await client.connect();
			const current = await client.query<{ database: string; readOnly: string }>(
				"SELECT current_database() AS database, current_setting('default_transaction_read_only') AS \"readOnly\"",
			);
			const database = current.rows[0]?.database;
			if (!database) throw new Error("Could not identify the source database.");
			journal.sourceWasReadOnly = current.rows[0]?.readOnly === "on";
			journal.sourceLocked = true;
			journal.phase = "Freezing writes";
			journal.message = "Marking the current database read-only and disconnecting existing sessions.";
			this.save(journal);
			await client.query("SET default_transaction_read_only = off");
			await client.query(`ALTER DATABASE ${quoteIdentifier(database)} SET default_transaction_read_only = on`);
			const terminated = await client.query<{ terminated: boolean }>(
				`SELECT pg_terminate_backend(pid) AS terminated
				FROM pg_stat_activity
				WHERE datname = current_database() AND pid <> pg_backend_pid()`,
			);
			if (terminated.rows.some((row) => row.terminated !== true)) {
				throw new Error("PostgreSQL did not allow all existing database sessions to be disconnected.");
			}
			await client.query("SET default_transaction_read_only = on");
			const check = clientFor(journal.sourceUrl);
			try {
				await check.connect();
				const readonly = await check.query<{ value: string }>(
					"SELECT current_setting('default_transaction_read_only') AS value",
				);
				if (readonly.rows[0]?.value !== "on") {
					throw new Error("Could not verify the source database write lock.");
				}
			} finally {
				await check.end().catch(() => undefined);
			}
		} finally {
			await client.end().catch(() => undefined);
		}
	}

	private async restoreSource(journal: DatabaseTransferJournal): Promise<void> {
		const client = clientFor(journal.sourceUrl);
		try {
			await client.connect();
			const database = (await client.query<{ database: string }>("SELECT current_database() AS database")).rows[0]
				?.database;
			if (!database) throw new Error("Could not identify the source database while restoring writes.");
			await client.query("SET default_transaction_read_only = off");
			if (journal.sourceWasReadOnly) {
				await client.query(
					`ALTER DATABASE ${quoteIdentifier(database)} SET default_transaction_read_only = on`,
				);
			} else {
				await client.query(`ALTER DATABASE ${quoteIdentifier(database)} RESET default_transaction_read_only`);
			}
			const terminated = await client.query<{ terminated: boolean }>(
				`SELECT pg_terminate_backend(pid) AS terminated
				FROM pg_stat_activity
				WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()`,
			);
			if (terminated.rows.some((row) => row.terminated !== true)) {
				throw new Error("PostgreSQL did not allow all sessions to reconnect with the restored write setting.");
			}
		} finally {
			await client.end().catch(() => undefined);
		}
	}

	private async copyDatabase(sourceUrl: string, targetUrl: string, replaceTarget: boolean): Promise<void> {
		if (replaceTarget) {
			await this.clearTarget(targetUrl);
		} else {
			await this.assertTargetEmpty(targetUrl);
		}
		const urls = [sourceUrl, targetUrl];
		const dump = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl"], {
			env: connectionEnvironment(sourceUrl),
			stdio: ["ignore", "pipe", "pipe"],
		});
		const restore = spawn(
			"pg_restore",
			["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", databaseName(targetUrl)],
			{ env: connectionEnvironment(targetUrl), stdio: ["pipe", "ignore", "pipe"] },
		);
		const dumpExit = childExit(dump, "pg_dump", urls);
		const restoreExit = childExit(restore, "pg_restore", urls);
		let streamError: unknown;
		try {
			await pipeline(dump.stdout, restore.stdin);
		} catch (error) {
			streamError = error;
		}

		const processResults = await Promise.allSettled([dumpExit, restoreExit]);
		const processErrors = processResults.flatMap((result) =>
			result.status === "rejected"
				? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
				: [],
		);
		if (processErrors.length > 0) {
			throw new Error(processErrors.join(" "));
		}
		if (streamError) {
			throw new Error(redact(streamError instanceof Error ? streamError.message : String(streamError), urls));
		}
	}
}
