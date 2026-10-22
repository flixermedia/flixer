import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaCredits1793900000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "media_credits" (
				"item_id" uuid NOT NULL,
				"person_key" text NOT NULL,
				"role" text NOT NULL,
				"name" text NOT NULL,
				"detail" text,
				"position" integer NOT NULL DEFAULT 0,
				CONSTRAINT "pk_media_credits" PRIMARY KEY ("item_id", "person_key", "role"),
				CONSTRAINT "fk_media_credits_item" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_media_credits_person" ON "media_credits" ("person_key", "role")`);

		// Backfill from the metadata already stored.
		for (const [field, fallbackRole] of [["cast", "actor"], ["crew", "crew"]] as const) {
			await queryRunner.query(`
				INSERT INTO "media_credits" ("item_id", "person_key", "role", "name", "detail", "position")
				SELECT i.id,
					lower(regexp_replace(btrim(p.value ->> 'name'), '\\s+', ' ', 'g')),
					lower(COALESCE(NULLIF(btrim(p.value ->> 'type'), ''), '${fallbackRole}')),
					btrim(p.value ->> 'name'),
					NULLIF(btrim(p.value ->> 'role'), ''),
					p.ordinality::int
				FROM "media_items" i
				CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.metadata -> '${field}') = 'array' THEN i.metadata -> '${field}' ELSE '[]'::jsonb END) WITH ORDINALITY AS p(value, ordinality)
				WHERE i.type IN ('movie', 'series', 'album', 'video') AND jsonb_typeof(p.value) = 'object' AND btrim(COALESCE(p.value ->> 'name', '')) <> ''
				ON CONFLICT DO NOTHING
			`);
		}
		for (const key of ["artist", "albumArtist"]) {
			await queryRunner.query(`
				INSERT INTO "media_credits" ("item_id", "person_key", "role", "name", "position")
				SELECT i.id, lower(regexp_replace(btrim(i.metadata ->> '${key}'), '\\s+', ' ', 'g')), '${key}', btrim(i.metadata ->> '${key}'), 0
				FROM "media_items" i
				WHERE i.type = 'album' AND jsonb_typeof(i.metadata -> '${key}') = 'string' AND btrim(i.metadata ->> '${key}') <> ''
				ON CONFLICT DO NOTHING
			`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "media_credits"`);
	}
}
