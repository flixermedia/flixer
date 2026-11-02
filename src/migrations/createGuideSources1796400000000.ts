import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGuideSources1796400000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "guide_sources" (
				"id" uuid NOT NULL,
				"kind" character varying(8) NOT NULL,
				"name" character varying(100) NOT NULL,
				"url" text NOT NULL,
				"enabled" boolean NOT NULL DEFAULT true,
				"is_default" boolean NOT NULL DEFAULT false,
				"sort_order" integer NOT NULL DEFAULT 0,
				"cache" jsonb NOT NULL DEFAULT '{"channels":[],"programmes":[]}',
				"channel_settings" jsonb NOT NULL DEFAULT '{}',
				"last_refreshed_at" TIMESTAMP WITH TIME ZONE,
				"last_error" text,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_guide_sources" PRIMARY KEY ("id"),
				CONSTRAINT "uq_guide_sources_kind_url" UNIQUE ("kind", "url"),
				CONSTRAINT "chk_guide_sources_kind" CHECK ("kind" IN ('epg', 'iptv'))
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "guide_settings" (
				"id" smallint NOT NULL DEFAULT 1,
				"regional_merge_threshold_percent" integer NOT NULL DEFAULT 65,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_guide_settings" PRIMARY KEY ("id"),
				CONSTRAINT "chk_guide_settings_singleton" CHECK ("id" = 1),
				CONSTRAINT "chk_guide_settings_threshold" CHECK ("regional_merge_threshold_percent" BETWEEN 1 AND 100)
			)
		`);
		await queryRunner.query(`
			INSERT INTO "guide_sources" ("id", "kind", "name", "url", "is_default", "sort_order") VALUES
			('0b7ce798-2365-43ad-bf7d-5bdeea34591e', 'epg', 'Freeview EPG (UK)', 'https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml', true, 0),
			('a618d4f4-880f-4bb3-badb-1f5768a5248e', 'iptv', 'UK IPTV (iptv-org)', 'https://iptv-org.github.io/iptv/countries/uk.m3u', true, 0)
		`);
		await queryRunner.query(`INSERT INTO "guide_settings" ("id") VALUES (1)`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "guide_settings"`);
		await queryRunner.query(`DROP TABLE "guide_sources"`);
	}
}
