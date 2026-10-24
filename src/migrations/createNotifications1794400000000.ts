import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotifications1794400000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "notifications" (
				"id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"kind" varchar(16) NOT NULL,
				"title" varchar(120) NOT NULL,
				"body" varchar(500) NOT NULL,
				"url" varchar(300),
				"read_at" TIMESTAMP WITH TIME ZONE,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_notifications" PRIMARY KEY ("id"),
				CONSTRAINT "fk_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_notifications_user_created" ON "notifications" ("user_id", "created_at")`);
		await queryRunner.query(`
			CREATE TABLE "push_subscriptions" (
				"id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"endpoint" varchar(1024) NOT NULL,
				"p256dh" varchar(256) NOT NULL,
				"auth" varchar(128) NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_push_subscriptions" PRIMARY KEY ("id"),
				CONSTRAINT "fk_push_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_push_subscriptions_user" ON "push_subscriptions" ("user_id")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "UQ_push_subscriptions_endpoint" ON "push_subscriptions" ("endpoint")`);
		await queryRunner.query(`
			CREATE TABLE "push_keys" (
				"id" integer NOT NULL,
				"public_key" varchar(128) NOT NULL,
				"private_key" varchar(128) NOT NULL,
				CONSTRAINT "pk_push_keys" PRIMARY KEY ("id")
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "push_keys"`);
		await queryRunner.query(`DROP TABLE "push_subscriptions"`);
		await queryRunner.query(`DROP TABLE "notifications"`);
	}
}
