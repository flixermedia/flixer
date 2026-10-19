import { injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { User } from "../entities/user.entity.js";
import { UserSession } from "../entities/userSession.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { UserPreference } from "../entities/userPreference.entity.js";
import { PasskeyChallenge } from "../entities/passkeyChallenge.entity.js";
import { PasskeyCredential } from "../entities/passkeyCredential.entity.js";
import { AddUsername1792190000000 } from "../migrations/addUsername1792190000000.js";
import { AddUserRole1792190300000 } from "../migrations/addUserRole1792190300000.js";
import { CreateUserSessions1792191000000 } from "../migrations/createUserSessions1792191000000.js";
import { CreateUsersTable1792186500000 } from "../migrations/createUsersTable1792186500000.js";
import { CreateSettings1792238400000 } from "../migrations/createSettings1792238400000.js";
import { CreatePasskeys1792300000000 } from "../migrations/createPasskeys1792300000000.js";
import { AddUserDisplayName1792400000000 } from "../migrations/addUserDisplayName1792400000000.js";
import { AddUserEmailVerified1792500000000 } from "../migrations/addUserEmailVerified1792500000000.js";
import { AddUserPendingEmail1792600000000 } from "../migrations/addUserPendingEmail1792600000000.js";
import { AddUserPasskeyRequired1792700000000 } from "../migrations/addUserPasskeyRequired1792700000000.js";
import { AddUserAvatar1792800000000 } from "../migrations/addUserAvatar1792800000000.js";
import { CreateUserPreferences1792900000000 } from "../migrations/createUserPreferences1792900000000.js";
import { MoveUserSettingsToPreferences1793000000000 } from "../migrations/moveUserSettingsToPreferences1793000000000.js";
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
			entities: [User, UserSession, Setting, PasskeyCredential, PasskeyChallenge, UserPreference],
			migrations: [
				CreateUsersTable1792186500000,
				AddUsername1792190000000,
				AddUserRole1792190300000,
				CreateUserSessions1792191000000,
				CreateSettings1792238400000,
				CreatePasskeys1792300000000,
				AddUserDisplayName1792400000000,
				AddUserEmailVerified1792500000000,
				AddUserPendingEmail1792600000000,
				AddUserPasskeyRequired1792700000000,
				AddUserAvatar1792800000000,
				CreateUserPreferences1792900000000,
				MoveUserSettingsToPreferences1793000000000,
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
