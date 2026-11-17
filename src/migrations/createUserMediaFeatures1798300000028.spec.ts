import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { CreateUserMediaFeatures1798300000028 } from "./createUserMediaFeatures1798300000028.js";

describe("CreateUserMediaFeatures1798300000028", () => {
	it("creates user-owned lists, queues, and feedback and can roll them back", async () => {
		const query = vi.fn().mockResolvedValue(undefined);
		const migration = new CreateUserMediaFeatures1798300000028();
		await migration.up({ query } as unknown as QueryRunner);
		const statement = query.mock.calls[0][0] as string;
		for (const table of ["watch_later_items", "video_collections", "video_collection_items", "up_next_queue_items", "recommendation_feedback"]) {
			expect(statement).toContain(`CREATE TABLE ${table}`);
		}
		expect(statement).toContain("REFERENCES users(id) ON DELETE CASCADE");
		await migration.down({ query } as unknown as QueryRunner);
		expect(query.mock.calls[1][0]).toContain("DROP TABLE recommendation_feedback");
	});
});
