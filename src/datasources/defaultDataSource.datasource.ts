import { injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { ENTITIES } from "./entityList.js";
import { MIGRATIONS } from "./migrationList.js";
import { LOG_SUCCESSFUL_API_REQUESTS_SETTING, setLogSuccessfulApiRequests } from "../config/logger/requestLog.js";
import { loadSecuritySettings } from "../config/loadSecuritySettings.js";
import { Setting } from "../entities/setting.entity.js";
import { cleanupExpiredOidcArtifacts } from "../api/oidc/oidcCleanup.js";
import { synchronizeSettings } from "../config/settingsSync.js";
import { appConfig } from "../config/store/appConfig.js";
import { cleanupExpiredUserSessions } from "../jobs/sessionCleanupJob.js";

export const DefaultDataSource = injectable(Symbol.for("DefaultDataSource"))
	.type("typeorm:datasource")
	.asyncFactory(async () => {
		const url = appConfig().get("databaseUrl");
		if (!url) {
			throw new Error("DATABASE_URL must be set to initialize the PostgreSQL DataSource.");
		}

		const dataSource = new DataSource({
			type: "postgres",
			url,
			// Explicit so the pool is sized above INDEXER_MAX_WRITES and always leaves connections for web requests.
			extra: {
				max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 100) || 100,
				idle_in_transaction_session_timeout: 60_000,
			},
			entities: ENTITIES,
			migrations: MIGRATIONS,
			synchronize: false,
			migrationsRun: false,
		});

		await dataSource.initialize();
		await dataSource.runMigrations();
		await synchronizeSettings(dataSource);
		const requestLoggingSetting = await dataSource.getRepository(Setting).findOneBy({ key: LOG_SUCCESSFUL_API_REQUESTS_SETTING });
		setLogSuccessfulApiRequests(requestLoggingSetting?.value === true);
		await loadSecuritySettings(dataSource, (message) => logger().warn(message));
		await cleanupExpiredUserSessions(dataSource);
		await cleanupExpiredOidcArtifacts(dataSource);
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
