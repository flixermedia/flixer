import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { RepairPlaybackHistory1798300000029 } from "./repairPlaybackHistory1798300000029.ts";

describe("RepairPlaybackHistory1798300000029", () => {
	it("repairs applied schemas and backfills legacy activity without restoring hidden sessions", async () => {
		const query = vi.fn().mockResolvedValue(undefined);
		await new RepairPlaybackHistory1798300000029().up({ query } as unknown as QueryRunner);
		const statement = query.mock.calls[0][0] as string;
		expect(statement).toContain("CREATE TABLE IF NOT EXISTS playback_history_hidden_sessions");
		expect(statement).toContain("REFERENCES media_items(id) ON DELETE CASCADE");
		expect(statement).toContain("FROM watch_progress progress");
		expect(statement).toContain("FROM listening_history listening");
		expect(statement).toContain("NOT EXISTS (SELECT 1 FROM playback_history_hidden_sessions");
	});
});