import { AsyncLocalStorage } from "node:async_hooks";
import type { DataSource, EntityManager, EntityTarget, ObjectLiteral, QueryRunner, Repository } from "typeorm";

export interface RlsIdentity {
	userId?: string;
	role?: string;
}

const rlsStorage = new AsyncLocalStorage<EntityManager>();

/** Applies the restricted flixer_app role and user/role GUCs for the lifetime of the current transaction. */
export async function applyRlsSession(queryRunner: QueryRunner, identity: RlsIdentity): Promise<void> {
	await queryRunner.query(`SET LOCAL ROLE flixer_app`);
	await queryRunner.query(`SELECT set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)`, [
		identity.userId ?? "",
		identity.role ?? "anonymous",
	]);
}

/** Runs fn inside a transaction bound to the flixer_app role and user identity via AsyncLocalStorage. */
export async function runWithRlsTransaction<T>(dataSource: DataSource, identity: RlsIdentity, fn: () => Promise<T>): Promise<T> {
	return dataSource.transaction(async (manager) => {
		const queryRunner = manager.queryRunner;
		if (queryRunner) {
			await applyRlsSession(queryRunner, identity);
		}
		return rlsStorage.run(manager, fn);
	});
}

/** Executes fn with an already-open QueryRunner's EntityManager bound in AsyncLocalStorage. */
export function runInRlsScope<T>(manager: EntityManager, fn: () => T): T {
	return rlsStorage.run(manager, fn);
}

/** Returns the active request-scoped RLS EntityManager if present, otherwise the DataSource manager. */
export function rlsManager(dataSource: DataSource): EntityManager {
	return rlsStorage.getStore() ?? dataSource.manager ?? (dataSource as unknown as EntityManager);
}

/** Drop-in replacement for dataSource.getRepository(entity) that participates in the active RLS transaction. */
export function rlsRepo<T extends ObjectLiteral>(dataSource: DataSource, entity: EntityTarget<T>): Repository<T> {
	return rlsManager(dataSource).getRepository(entity);
}
