import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserAvatar1792800000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "avatar_file" varchar(128)');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "avatar_file"');
	}
}
