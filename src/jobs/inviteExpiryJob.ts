import { logger } from "@tsed/di";
import { DataSource, IsNull, LessThanOrEqual, Not } from "typeorm";
import { InvitationUsage } from "../entities/invitationUsage.entity.js";
import { User } from "../entities/user.entity.js";

export const INVITE_EXPIRY_JOB = "disable-expired-invite-accounts";

/** Disables Flixer accounts whose invitation granted a limited membership that has now run out. */
export async function disableExpiredInviteAccounts(dataSource: DataSource): Promise<void> {

	const due = await dataSource.getRepository(InvitationUsage).find({
		where: { expiresAt: LessThanOrEqual(new Date()), userDisabledAt: IsNull(), userId: Not(IsNull()) },
	});

	let disabled = 0;
	for (const usage of due) {
		// Administrators stay usable, and the marker makes a manual re-enable stick.
		const result = await dataSource.getRepository(User).update({ id: usage.userId!, disabledAt: IsNull(), role: "user" }, { disabledAt: new Date() });
		disabled += result.affected ?? 0;
		await dataSource.getRepository(InvitationUsage).update({ id: usage.id }, { userDisabledAt: new Date() });
	}

	if (disabled) {
		logger().info(`Disabled ${disabled} expired invite account(s).`);
	}

}
