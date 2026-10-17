import { BadRequest, NotFound } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { AuthService } from "../auth/authService.js";
import { SettingRequest } from "./settingRequest.js";

export interface PublicSetting {
	key: string;
	value: unknown | null;
	isPublic: boolean;
	updatedAt: Date;
}

const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;

@Injectable()
export class SettingsService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	async list(authorization?: string): Promise<PublicSetting[]> {
		const actor = await this.authService.getAuthenticatedUser(authorization);
		const settings = await this.dataSource.getRepository(Setting).find({
			where: actor.role === "admin" ? undefined : { isPublic: true },
			order: { key: "ASC" },
		});

		return settings.map((setting) => this.toPublicSetting(setting));
	}

	async update(key: string, request: SettingRequest, authorization?: string): Promise<PublicSetting> {
		await this.authService.requireAdmin(authorization);

		if (!SETTING_KEY_PATTERN.test(key)) {
			throw new BadRequest("Setting key has an invalid format.");
		}

		const settings = this.dataSource.getRepository(Setting);
		const setting = await settings.findOneBy({ key });
		if (!setting) {
			throw new NotFound("Setting not found. Add new settings through a database migration.");
		}

		setting.value = request.value;
		return this.toPublicSetting(await settings.save(setting));
	}

	private toPublicSetting(setting: Setting): PublicSetting {
		return {
			key: setting.key,
			value: setting.value,
			isPublic: setting.isPublic,
			updatedAt: setting.updatedAt,
		};
	}
}
