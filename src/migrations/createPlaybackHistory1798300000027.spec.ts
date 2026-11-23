import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { CreatePlaybackHistory1798300000027 } from "./createPlaybackHistory1798300000027.js";

describe("CreatePlaybackHistory1798300000027", () => {
	it("creates owner-bound video, music, and live history and can roll it back", async () => {
		const query = vi.fn().mockResolvedValue(undefined);
		const migration = new CreatePlaybackHistory1798300000027();
		await migration.up({ query } as unknown as QueryRunner);
		const statement = query.mock.calls[0][0] as string;
		expect(statement).toContain("REFERENCES users(id) ON DELETE CASCADE");
		expect(statement).toContain("REFERENCES media_items(id) ON DELETE CASCADE");
		expect(statement).toContain("kind IN ('video', 'music', 'live')");
		expect(statement).toContain("idx_playback_history_user_started");
		expect(statement).toContain("CREATE TABLE playback_history_hidden_sessions");
		expect(statement).toContain("FROM viewing_sessions");
		expect(statement).toContain("FROM listening_events event");
		await migration.down({ query } as unknown as QueryRunner);
		expect(query.mock.calls[1][0]).toContain("DROP TABLE playback_history_hidden_sessions");
	});
});
