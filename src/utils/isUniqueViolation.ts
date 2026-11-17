/** True for a TypeORM query failure caused by a Postgres unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
	const driverError = typeof error === "object" && error !== null && "driverError" in error ? error.driverError : undefined;
	return typeof driverError === "object" && driverError !== null && "code" in driverError && driverError.code === "23505";
}
