import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource, MoreThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { UserSession } from "../../entities/userSession.entity.js";
import { describeClient } from "./userAgent.js";

export interface PublicDevice {
	id: string;
	device: string;
	app: string;
	user: { id: string; username: string; displayName: string };
	ipAddress: string | null;
	createdAt: Date;
	lastSeenAt: Date;
	current: boolean;
}

/** Every signed-in session on the server, presented as a device. */
@Injectable()
export class DevicesService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(currentSessionId: string): Promise<PublicDevice[]> {
		const sessions = await this.dataSource.getRepository(UserSession).find({
			where: { expiresAt: MoreThan(new Date()) },
			relations: { user: true },
			order: { lastSeenAt: "DESC" },
		});

		return sessions.map((session) => {
			const { device, app } = describeClient(session.userAgent);
			return {
				id: session.id,
				device,
				app,
				user: {
					id: session.userId,
					username: session.user?.username ?? "",
					displayName: session.user?.displayName ?? session.user?.username ?? "",
				},
				ipAddress: session.ipAddress,
				createdAt: session.createdAt,
				lastSeenAt: session.lastSeenAt,
				current: session.id === currentSessionId,
			};
		});
	}

	async signOut(id: string, currentSessionId: string): Promise<void> {
		if (id === currentSessionId) {
			throw new BadRequest("Use the account menu to sign out of this device.");
		}

		const result = await this.dataSource.getRepository(UserSession).delete({ id });
		if (!result.affected) {
			throw new NotFound("Device not found.");
		}
	}
}
