import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePayments1798300000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_config" (
			"id" integer PRIMARY KEY DEFAULT 1,
			"config" jsonb NOT NULL DEFAULT '{}',
			"secrets" text,
			"updated_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_products" (
			"id" uuid PRIMARY KEY,
			"name" varchar(200) NOT NULL,
			"description" text,
			"kind" varchar(8) NOT NULL,
			"scope" jsonb NOT NULL,
			"prices" jsonb NOT NULL DEFAULT '[]',
			"rental_hours" integer,
			"rental_start" varchar(16) NOT NULL DEFAULT 'purchase',
			"active" boolean NOT NULL DEFAULT true,
			"sort_order" integer NOT NULL DEFAULT 0,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_plans" (
			"id" uuid PRIMARY KEY,
			"name" varchar(200) NOT NULL,
			"description" text,
			"interval" varchar(8) NOT NULL,
			"prices" jsonb NOT NULL DEFAULT '[]',
			"scopes" jsonb NOT NULL DEFAULT '[]',
			"trial_days" integer NOT NULL DEFAULT 0,
			"active" boolean NOT NULL DEFAULT true,
			"sort_order" integer NOT NULL DEFAULT 0,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_coupons" (
			"id" uuid PRIMARY KEY,
			"code" varchar(64) NOT NULL UNIQUE,
			"description" text,
			"percent_off" integer,
			"amount_off" jsonb,
			"max_redemptions" integer,
			"redeemed" integer NOT NULL DEFAULT 0,
			"expires_at" timestamptz,
			"product_ids" jsonb NOT NULL DEFAULT '[]',
			"plan_ids" jsonb NOT NULL DEFAULT '[]',
			"active" boolean NOT NULL DEFAULT true,
			"created_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_customers" (
			"id" uuid PRIMARY KEY,
			"user_id" uuid NOT NULL,
			"provider" varchar(16) NOT NULL,
			"customer_id" varchar(128) NOT NULL,
			"created_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_customers_user_provider" ON "payment_customers" ("user_id", "provider")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_methods" (
			"id" uuid PRIMARY KEY,
			"user_id" uuid NOT NULL,
			"provider" varchar(16) NOT NULL,
			"provider_ref" varchar(128) NOT NULL,
			"brand" varchar(32) NOT NULL,
			"last4" varchar(4) NOT NULL,
			"exp_month" integer NOT NULL,
			"exp_year" integer NOT NULL,
			"is_default" boolean NOT NULL DEFAULT false,
			"created_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_methods_user" ON "payment_methods" ("user_id")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_orders" (
			"id" uuid PRIMARY KEY,
			"user_id" uuid NOT NULL,
			"kind" varchar(16) NOT NULL,
			"product_id" uuid,
			"plan_id" uuid,
			"subscription_id" uuid,
			"description" text NOT NULL,
			"currency" varchar(3) NOT NULL,
			"subtotal_minor" integer NOT NULL,
			"discount_minor" integer NOT NULL DEFAULT 0,
			"tax_minor" integer NOT NULL DEFAULT 0,
			"total_minor" integer NOT NULL,
			"coupon_code" varchar(64),
			"status" varchar(24) NOT NULL,
			"provider" varchar(16),
			"provider_ref" varchar(128),
			"refunded_minor" integer NOT NULL DEFAULT 0,
			"failure" text,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_orders_user" ON "payment_orders" ("user_id")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_orders_provider_ref" ON "payment_orders" ("provider_ref")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_entitlements" (
			"id" uuid PRIMARY KEY,
			"user_id" uuid NOT NULL,
			"source" varchar(16) NOT NULL,
			"order_id" uuid,
			"scope" jsonb NOT NULL,
			"expires_at" timestamptz,
			"claim_until" timestamptz,
			"rental_hours" integer,
			"activated_at" timestamptz,
			"revoked_at" timestamptz,
			"created_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_entitlements_user" ON "payment_entitlements" ("user_id")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_subscriptions" (
			"id" uuid PRIMARY KEY,
			"user_id" uuid NOT NULL,
			"plan_id" uuid NOT NULL,
			"status" varchar(16) NOT NULL,
			"currency" varchar(3) NOT NULL,
			"amount_minor" integer NOT NULL,
			"period_end" timestamptz NOT NULL,
			"cancel_at_period_end" boolean NOT NULL DEFAULT false,
			"failed_attempts" integer NOT NULL DEFAULT 0,
			"next_attempt_at" timestamptz,
			"grace_until" timestamptz,
			"canceled_at" timestamptz,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_subscriptions_user" ON "payment_subscriptions" ("user_id")`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_events" (
			"id" uuid PRIMARY KEY,
			"provider" varchar(16) NOT NULL,
			"event_id" varchar(160) NOT NULL,
			"created_at" timestamptz NOT NULL DEFAULT now()
		)`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_events_provider_event" ON "payment_events" ("provider", "event_id")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		for (const table of [
			"payment_events", "payment_subscriptions", "payment_entitlements", "payment_orders", "payment_methods",
			"payment_customers", "payment_coupons", "payment_plans", "payment_products", "payment_config",
		]) {
			await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
		}
	}
}
