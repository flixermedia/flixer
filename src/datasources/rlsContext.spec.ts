import { describe, expect, it, vi } from "vitest";
import type { DataSource, EntityManager } from "typeorm";
import { Favorite } from "../entities/favorite.entity.js";
import { rlsManager, rlsRepo, runInRlsScope, runWithRlsTransaction } from "./rlsContext.js";

describe("rlsContext", () => {
	it("falls back to dataSource.manager when outside an RLS scope", () => {
		const fallbackRepo = { marker: "fallback" };
		const fallbackManager = { getRepository: vi.fn().mockReturnValue(fallbackRepo) } as unknown as EntityManager;
		const dataSource = { manager: fallbackManager } as unknown as DataSource;

		expect(rlsManager(dataSource)).toBe(fallbackManager);
		expect(rlsRepo(dataSource, Favorite)).toBe(fallbackRepo);
	});

	it("returns the scoped EntityManager inside runInRlsScope", () => {
		const scopedRepo = { marker: "scoped" };
		const scopedManager = { getRepository: vi.fn().mockReturnValue(scopedRepo) } as unknown as EntityManager;
		const fallbackManager = { getRepository: vi.fn() } as unknown as EntityManager;
		const dataSource = { manager: fallbackManager } as unknown as DataSource;

		const result = runInRlsScope(scopedManager, () => rlsRepo(dataSource, Favorite));
		expect(result).toBe(scopedRepo);
		expect(fallbackManager.getRepository).not.toHaveBeenCalled();
	});

	it("sets flixer_app role and session GUCs inside runWithRlsTransaction", async () => {
		const query = vi.fn().mockResolvedValue([]);
		const scopedRepo = { marker: "tx" };
		const txManager = {
			queryRunner: { query },
			getRepository: vi.fn().mockReturnValue(scopedRepo),
		} as unknown as EntityManager;
		const dataSource = {
			manager: {} as EntityManager,
			transaction: vi.fn(async (cb: (m: EntityManager) => Promise<unknown>) => cb(txManager)),
		} as unknown as DataSource;

		const got = await runWithRlsTransaction(dataSource, { userId: "user-123", role: "user" }, async () => {
			return rlsRepo(dataSource, Favorite);
		});

		expect(got).toBe(scopedRepo);
		expect(query).toHaveBeenNthCalledWith(1, "SET LOCAL ROLE flixer_app");
		expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)", ["user-123", "user"]);
	});
});
