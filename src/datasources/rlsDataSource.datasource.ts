import { injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { ENTITIES } from "./entityList.js";
import { appConfig } from "../config/store/appConfig.js";

/** Dedicated PostgreSQL pool for request-scoped RLS transactions so they cannot deadlock with DefaultDataSource queries. */
export const RlsDataSource = injectable(Symbol.for("RlsDataSource"))
	.type("typeorm:datasource")
	.asyncFactory(async () => {
		const url = appConfig().get("databaseUrl");
		if (!url) {
			throw new Error("DATABASE_URL must be set to initialize the RLS PostgreSQL DataSource.");
		}

		const dataSource = new DataSource({
			type: "postgres",
			url,
			extra: {
				max: Number.parseInt(process.env.RLS_DATABASE_POOL_MAX ?? "", 100) || 250,
				idle_in_transaction_session_timeout: 60_000,
			},
			entities: ENTITIES,
			synchronize: false,
			migrationsRun: false,
		});

		await dataSource.initialize();
		return dataSource;
	})
	.hooks({
		$onDestroy(source) {
			return source.isInitialized ? source.destroy() : undefined;
		},
	})
	.token();

export type RlsDataSource = DataSource;
