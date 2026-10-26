import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSocial1795400000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "user_preferences" ADD COLUMN "profile_hidden" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`
			CREATE TABLE "favorites" (
				"user_id" uuid NOT NULL,
				"item_id" uuid NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_favorites" PRIMARY KEY ("user_id", "item_id"),
				CONSTRAINT "fk_favorites_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_favorites_item" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_favorites_user_created" ON "favorites" ("user_id", "created_at")`);
		await queryRunner.query(`
			CREATE TABLE "playlists" (
				"id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"name" varchar(100) NOT NULL,
				"description" varchar(500),
				"is_public" boolean NOT NULL DEFAULT true,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_playlists" PRIMARY KEY ("id"),
				CONSTRAINT "fk_playlists_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_playlists_user" ON "playlists" ("user_id")`);
		await queryRunner.query(`
			CREATE TABLE "playlist_items" (
				"playlist_id" uuid NOT NULL,
				"item_id" uuid NOT NULL,
				"position" integer NOT NULL DEFAULT 0,
				"added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_playlist_items" PRIMARY KEY ("playlist_id", "item_id"),
				CONSTRAINT "fk_playlist_items_playlist" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_playlist_items_item" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_playlist_items_order" ON "playlist_items" ("playlist_id", "position")`);
		await queryRunner.query(`
			CREATE TABLE "listening_history" (
				"user_id" uuid NOT NULL,
				"item_id" uuid NOT NULL,
				"played_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"play_count" integer NOT NULL DEFAULT 1,
				CONSTRAINT "pk_listening_history" PRIMARY KEY ("user_id", "item_id"),
				CONSTRAINT "fk_listening_history_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_listening_history_item" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_listening_history_user_played" ON "listening_history" ("user_id", "played_at")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "listening_history"`);
		await queryRunner.query(`DROP TABLE "playlist_items"`);
		await queryRunner.query(`DROP TABLE "playlists"`);
		await queryRunner.query(`DROP TABLE "favorites"`);
		await queryRunner.query(`ALTER TABLE "user_preferences" DROP COLUMN "profile_hidden"`);
	}
}
