import { describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { NormalizeChapterTitles1798300000004 } from "./normalizeChapterTitles1798300000004.js";

describe.skipIf(!process.env.CHAPTER_TEST_PG_SOCKET)("chapter title migration (PostgreSQL)", () => {
	it("updates both chapter lists without altering other data and is idempotent", async () => {
		const source = new DataSource({
			type: "postgres", host: process.env.CHAPTER_TEST_PG_SOCKET, port: 55439,
			username: process.env.USER, database: "postgres",
		});
		await source.initialize();
		const runner = source.createQueryRunner();
		try {
			await runner.query(`CREATE TEMP TABLE media_items (id integer PRIMARY KEY, technical jsonb, metadata jsonb)`);
			const technical = {
				codec: "h264",
				chapters: [
					{ title: "00:04:53.126", start: 293.126, end: 500, extra: true },
					{ title: "Opening", start: 0, end: 100 },
					{ title: "01:00:00", start: 3600, end: 4000 },
					{ title: "00:90:00", start: 4000, end: 4100 },
					null,
				],
			};
			const metadata = { overview: "Keep", adminChapters: [{ title: "00:00:00.000", start: 0, end: 5 }, { title: "Credits", start: 5, end: 10 }] };
			await runner.query(`INSERT INTO media_items VALUES (1, $1::jsonb, $2::jsonb), (2, NULL, '{"adminChapters":null}')`, [JSON.stringify(technical), JSON.stringify(metadata)]);
			const migration = new NormalizeChapterTitles1798300000004();
			await migration.up(runner);
			const rows = await runner.query(`SELECT * FROM media_items ORDER BY id`);
			expect(rows).toEqual([
				{
					id: 1,
					technical: { ...technical, chapters: [
						{ ...technical.chapters[0], title: "Chapter 2" }, technical.chapters[1],
						{ ...technical.chapters[2], title: "Chapter 3" }, technical.chapters[3], null,
					] },
					metadata: { ...metadata, adminChapters: [{ title: "Chapter 1", start: 0, end: 5 }, metadata.adminChapters[1]] },
				},
				{ id: 2, technical: null, metadata: { adminChapters: null } },
			]);
			await migration.up(runner);
			expect(await runner.query(`SELECT * FROM media_items ORDER BY id`)).toEqual(rows);
		} finally {
			await runner.release();
			await source.destroy();
		}
	});
});
