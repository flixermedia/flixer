import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaCreditImage1794100000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_credits" ADD COLUMN "image" text`);
		await queryRunner.query(`
			UPDATE "media_credits" c SET "image" = s."image"
			FROM (
				SELECT DISTINCT ON (i.id, k."person_key") i.id AS "item_id", k."person_key", btrim(p.value ->> 'image') AS "image"
				FROM "media_items" i
				CROSS JOIN LATERAL jsonb_array_elements(
					(CASE WHEN jsonb_typeof(i.metadata -> 'cast') = 'array' THEN i.metadata -> 'cast' ELSE '[]'::jsonb END) ||
					(CASE WHEN jsonb_typeof(i.metadata -> 'crew') = 'array' THEN i.metadata -> 'crew' ELSE '[]'::jsonb END)
				) AS p(value)
				CROSS JOIN LATERAL (SELECT lower(regexp_replace(btrim(COALESCE(p.value ->> 'name', '')), '\\s+', ' ', 'g')) AS "person_key") k
				WHERE jsonb_typeof(p.value) = 'object' AND btrim(COALESCE(p.value ->> 'image', '')) <> ''
			) s
			WHERE c."item_id" = s."item_id" AND c."person_key" = s."person_key"
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_credits" DROP COLUMN "image"`);
	}
}
