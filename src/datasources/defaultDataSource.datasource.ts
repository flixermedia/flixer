import { injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { User } from "../entities/user.entity.js";
import { UserSession } from "../entities/userSession.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { AddUsername1792190000000 } from "../migrations/addUsername1792190000000.js";
import { AddUserRole1792190300000 } from "../migrations/addUserRole1792190300000.js";
import { CreateUserSessions1792191000000 } from "../migrations/createUserSessions1792191000000.js";
import { CreateUsersTable1792186500000 } from "../migrations/createUsersTable1792186500000.js";
import { CreateSettings1792238400000 } from "../migrations/createSettings1792238400000.js";
import { synchronizeSettings } from "../config/settingsSync.js";
import { cleanupExpiredUserSessions } from "../jobs/sessionCleanupJob.js";

export const DefaultDataSource = injectable(Symbol.for("DefaultDataSource"))
	.type("typeorm:datasource")
	.asyncFactory(async () => {
		const url = process.env.DATABASE_URL;
		if (!url) {
			throw new Error("DATABASE_URL must be set to initialize the PostgreSQL DataSource.");
		}

		const dataSource = new DataSource({
			type: "postgres",
			url,
			entities: [User, UserSession, Setting],
			migrations: [
				CreateUsersTable1792186500000,
				AddUsername1792190000000,
				AddUserRole1792190300000,
				CreateUserSessions1792191000000,
				CreateSettings1792238400000,
			],
			synchronize: false,
			migrationsRun: false,
		});

		await dataSource.initialize();
		await dataSource.runMigrations();
		await synchronizeSettings(dataSource);
		await cleanupExpiredUserSessions(dataSource);
		logger().info("Connected to PostgreSQL.");

		return dataSource;
	})
	.hooks({
		$onDestroy(source) {
			return source.isInitialized ? source.destroy() : undefined;
		},
	})
	.token();

export type DefaultDataSource = DataSource;
