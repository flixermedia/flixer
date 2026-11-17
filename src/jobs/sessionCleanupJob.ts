import { logger } from "@tsed/di";
import { DataSource, LessThanOrEqual } from "typeorm";
import { UserSession } from "../entities/userSession.entity.js";

export const SESSION_CLEANUP_JOB = "cleanup-expired-user-sessions";

export async function cleanupExpiredUserSessions(dataSource: DataSource): Promise<void> {

	const result = await dataSource.getRepository(UserSession).delete({
		expiresAt: LessThanOrEqual(new Date()),
	});

	if (result.affected) {
		logger().info(`Removed ${result.affected} expired user session(s).`);
	}

}
