import type { MigrationInterface, QueryRunner } from "typeorm";

export class NormalizeChapterTitles1798300000004 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		for (const [column, field] of [["technical", "chapters"], ["metadata", "adminChapters"]] as const) {
			await queryRunner.query(`
				UPDATE "media_items" AS item
				SET "${column}" = jsonb_set(item."${column}", '{${field}}', (
					SELECT jsonb_agg(
						CASE WHEN jsonb_typeof(chapter) = 'object'
							AND jsonb_typeof(chapter->'title') = 'string'
							AND chapter->>'title' ~ '^[[:space:]]*[0-9]{2,}:[0-5][0-9]:[0-5][0-9]([.][0-9]+)?[[:space:]]*$'
						THEN jsonb_set(chapter, '{title}', to_jsonb('Chapter ' || position::text))
						ELSE chapter END ORDER BY ordinal
					)
					FROM (
						SELECT chapter, ordinal, row_number() OVER (
							ORDER BY CASE WHEN jsonb_typeof(chapter->'start') = 'number'
								THEN (chapter->>'start')::numeric END NULLS LAST, ordinal
						) AS position
						FROM jsonb_array_elements(CASE WHEN jsonb_typeof(item."${column}"->'${field}') = 'array'
							THEN item."${column}"->'${field}' ELSE '[]'::jsonb END)
							WITH ORDINALITY AS entries(chapter, ordinal)
					) AS ordered
				))
				WHERE jsonb_typeof(item."${column}"->'${field}') = 'array'
				AND EXISTS (
					SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(item."${column}"->'${field}') = 'array'
						THEN item."${column}"->'${field}' ELSE '[]'::jsonb END) AS entries(chapter)
					WHERE jsonb_typeof(chapter->'title') = 'string'
						AND chapter->>'title' ~ '^[[:space:]]*[0-9]{2,}:[0-5][0-9]:[0-5][0-9]([.][0-9]+)?[[:space:]]*$'
				)
			`);
		}
	}

	async down(): Promise<void> {
		// The original timestamp titles cannot be recovered.
	}
}
