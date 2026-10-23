import pg from "pg";

export type DatabaseProbe = { ok: true; hasUsers: boolean } | { ok: false; reason: "unconfigured" | "unavailable"; message: string };

const PROBE_TIMEOUT_MS = 5000;

/** Removes anything that could carry the password from a driver error before it is logged or returned. */
function describe(error: unknown, url: string): string {
	let text = error instanceof Error ? error.message : String(error);
	try {
		const parsed = new URL(url);
		for (const secret of [parsed.password, decodeURIComponent(parsed.password)]) {
			if (secret) {
				text = text.split(secret).join("***");
			}
		}
	} catch {
		// The URL itself is unparsable; the message cannot contain a parsed password.
	}
	return text.replace(/\s+/g, " ").trim() || "The database did not respond.";
}

/** Opens one short-lived connection to check that PostgreSQL is reachable and whether the app already has users. */
export async function probeDatabase(url: string | undefined): Promise<DatabaseProbe> {
	if (!url) {
		return { ok: false, reason: "unconfigured", message: "No database connection is configured." };
	}
	const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS, query_timeout: PROBE_TIMEOUT_MS });
	client.on("error", () => undefined);
	try {
		await client.connect();
		const table = await client.query<{ exists: boolean }>("SELECT to_regclass('public.users') IS NOT NULL AS exists");
		let hasUsers = false;
		if (table.rows[0]?.exists) {
			const count = await client.query<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM users) AS present");
			hasUsers = count.rows[0]?.present === true;
		}
		return { ok: true, hasUsers };
	} catch (error: unknown) {
		return { ok: false, reason: "unavailable", message: describe(error, url) };
	} finally {
		await client.end().catch(() => undefined);
	}
}
