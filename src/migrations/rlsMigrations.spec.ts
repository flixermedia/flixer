import { describe, expect, it } from "vitest";
import { getMetadataArgsStorage } from "typeorm";
import { ENTITIES } from "../datasources/entityList.js";
import { EnableUserOwnedRls1798300000043 } from "./enableUserOwnedRls1798300000043.js";
import { EnableRemainingUserOwnedRls1798300000044 } from "./enableRemainingUserOwnedRls1798300000044.js";
import { EnableSocialAndSharedRls1798300000045 } from "./enableSocialAndSharedRls1798300000045.js";
import { EnableCatalogAndAdminRls1798300000046 } from "./enableCatalogAndAdminRls1798300000046.js";

describe("RLS migration coverage", () => {
	it("enables ROW LEVEL SECURITY on every entity table in ENTITIES", async () => {
		const enabledTables = new Set<string>();
		const recorder = {
			query: async (sql: string) => {
				const match = /ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY/i.exec(sql);
				if (match) enabledTables.add(match[1]);
				return [];
			},
		};

		await new EnableUserOwnedRls1798300000043().up(recorder as never);
		await new EnableRemainingUserOwnedRls1798300000044().up(recorder as never);
		await new EnableSocialAndSharedRls1798300000045().up(recorder as never);
		await new EnableCatalogAndAdminRls1798300000046().up(recorder as never);

		const entitySet = new Set<unknown>(ENTITIES);
		const entityTables = getMetadataArgsStorage()
			.tables.filter((table) => entitySet.has(table.target))
			.map((table) => table.name)
			.filter((name): name is string => Boolean(name));

		const missing = entityTables.filter((name) => !enabledTables.has(name));
		expect(missing).toEqual([]);
	});
});
