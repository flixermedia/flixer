import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaSearchOutbox1796100000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "media_search_outbox" (
				"event_id" bigserial PRIMARY KEY,
				"item_id" uuid,
				"operation" text NOT NULL CHECK ("operation" IN ('upsert', 'delete', 'rebuild')),
				"document" jsonb,
				"created_at" timestamptz NOT NULL DEFAULT now(),
				"attempts" integer NOT NULL DEFAULT 0,
				"next_attempt_at" timestamptz NOT NULL DEFAULT now(),
				"locked_until" timestamptz,
				"last_error" text
			)
		`);
		await queryRunner.query(`
			CREATE INDEX "IDX_media_search_outbox_ready"
			ON "media_search_outbox" ("next_attempt_at", "locked_until", "event_id")
		`);
		await queryRunner.query(`
			CREATE UNIQUE INDEX "UQ_media_search_outbox_rebuild"
			ON "media_search_outbox" ("operation")
			WHERE "operation" = 'rebuild'
		`);
		await queryRunner.query(`
			CREATE FUNCTION enqueue_media_search_document() RETURNS trigger AS $$
			DECLARE
				search_document jsonb;
			BEGIN
				IF TG_OP = 'DELETE' THEN
					INSERT INTO "media_search_outbox" ("item_id", "operation")
					VALUES (OLD."id", 'delete');
					RETURN OLD;
				END IF;

				IF NEW."is_placeholder" THEN
					INSERT INTO "media_search_outbox" ("item_id", "operation")
					VALUES (NEW."id", 'delete');
				ELSE
					search_document := jsonb_build_object(
						'id', NEW."id"::text,
						'type', NEW."type",
						'title', NEW."title",
						'sortTitle', COALESCE(NEW."sort_title", NEW."title"),
						'year', NEW."year",
						'genres', CASE
							WHEN jsonb_typeof(NEW."metadata" -> 'genres') = 'array' THEN NEW."metadata" -> 'genres'
							ELSE '[]'::jsonb
						END,
						'searchText', concat_ws(' ',
							NEW."title",
							NEW."sort_title",
							NEW."metadata" ->> 'overview',
							NEW."metadata" ->> 'tagline',
							NEW."metadata" ->> 'artist',
							NEW."metadata" ->> 'albumArtist',
							(NEW."metadata" -> 'cast')::text,
							(NEW."metadata" -> 'crew')::text
						),
						'createdAt', NEW."created_at"
					);
					INSERT INTO "media_search_outbox" ("item_id", "operation", "document")
					VALUES (NEW."id", 'upsert', search_document);
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`);
		await queryRunner.query(`
			CREATE TRIGGER "TR_media_items_search_outbox"
			AFTER INSERT OR UPDATE OR DELETE ON "media_items"
			FOR EACH ROW EXECUTE FUNCTION enqueue_media_search_document()
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TRIGGER "TR_media_items_search_outbox" ON "media_items"`);
		await queryRunner.query(`DROP FUNCTION enqueue_media_search_document()`);
		await queryRunner.query(`DROP TABLE "media_search_outbox"`);
	}
}
