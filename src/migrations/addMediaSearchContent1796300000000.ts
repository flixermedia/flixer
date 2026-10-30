import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaSearchContent1796300000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "media_search_lyrics" (
				"item_id" uuid PRIMARY KEY REFERENCES "media_items"("id") ON DELETE CASCADE,
				"lyrics" text NOT NULL,
				"updated_at" timestamptz NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`
			CREATE FUNCTION enqueue_media_search_ancestors() RETURNS trigger AS $$
			DECLARE
				parent_ids uuid[];
			BEGIN
				IF TG_OP = 'UPDATE'
					AND NEW."type" IS NOT DISTINCT FROM OLD."type"
					AND NEW."title" IS NOT DISTINCT FROM OLD."title"
					AND NEW."parent_id" IS NOT DISTINCT FROM OLD."parent_id"
					AND NEW."metadata" IS NOT DISTINCT FROM OLD."metadata"
					AND NEW."is_placeholder" IS NOT DISTINCT FROM OLD."is_placeholder"
				THEN
					RETURN NEW;
				END IF;

				IF TG_OP = 'DELETE' THEN
					parent_ids := ARRAY[OLD."parent_id"];
				ELSE
					parent_ids := ARRAY[NEW."parent_id"];
					IF TG_OP = 'UPDATE' AND NEW."parent_id" IS DISTINCT FROM OLD."parent_id" THEN
						parent_ids := array_append(parent_ids, OLD."parent_id");
					END IF;
				END IF;

				WITH RECURSIVE ancestors("id", "parent_id") AS (
					SELECT item."id", item."parent_id"
					FROM "media_items" item
					WHERE item."id" = ANY(parent_ids)
					UNION ALL
					SELECT parent."id", parent."parent_id"
					FROM ancestors
					JOIN "media_items" parent ON parent."id" = ancestors."parent_id"
				)
				INSERT INTO "media_search_outbox" ("item_id", "operation")
				SELECT DISTINCT ancestors."id", 'upsert'
				FROM ancestors
				ON CONFLICT DO NOTHING;

				IF TG_OP = 'DELETE' THEN
					RETURN OLD;
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`);
		await queryRunner.query(`
			CREATE TRIGGER "TR_media_items_search_ancestors"
			AFTER INSERT OR UPDATE OR DELETE ON "media_items"
			FOR EACH ROW EXECUTE FUNCTION enqueue_media_search_ancestors()
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TRIGGER "TR_media_items_search_ancestors" ON "media_items"`);
		await queryRunner.query(`DROP FUNCTION enqueue_media_search_ancestors()`);
		await queryRunner.query(`DROP TABLE "media_search_lyrics"`);
	}
}
