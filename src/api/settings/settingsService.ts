import { BadRequest, NotFound } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { AuthService } from "../auth/authService.js";
import { SENTRY_SETTING_KEYS, SentryService } from "../../sentry/sentryService.js";
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
		private readonly sentryService: SentryService,
	) {}

	async list(authorization?: string): Promise<PublicSetting[]> {
		const actor = await this.authService.getAuthenticatedUser(authorization);
		const settings = await this.dataSource.getRepository(Setting).find({
			where: actor.role === "admin" ? undefined : { isPublic: true },
			order: { key: "ASC" },
		});

		return settings.map((setting) => this.toPublicSetting(setting));
	}

	async getRegistrationStatus(): Promise<{ registrationEnabled: boolean }> {
		const setting = await this.dataSource.getRepository(Setting).findOneBy({ key: "registration_enabled" });
		if (!setting || typeof setting.value !== "boolean") {
			throw new Error("The registration_enabled setting is missing or invalid.");
		}

		return { registrationEnabled: setting.value };
	}

	async update(key: string, request: SettingRequest, authorization?: string): Promise<PublicSetting> {
		await this.authService.requireAdmin(authorization);

		if (!SETTING_KEY_PATTERN.test(key)) {
			throw new BadRequest("Setting key has an invalid format.");
		}
		if (key === "registration_enabled" && typeof request.value !== "boolean") {
			throw new BadRequest("The registration_enabled setting must be a boolean.");
		}

		if (key.startsWith("sentry_")) {
			this.validateSentrySetting(key, request.value);
		}

		const settings = this.dataSource.getRepository(Setting);
		const setting = await settings.findOneBy({ key });
		if (!setting) {
			throw new NotFound("Setting not found. Add new settings through a database migration.");
		}

		setting.value = request.value;
		const saved = await settings.save(setting);
		if (SENTRY_SETTING_KEYS.includes(key)) {
			await this.sentryService.apply();
		}

		return this.toPublicSetting(saved);
	}

	private validateSentrySetting(key: string, value: unknown): void {
		if (key.endsWith("_dsn")) {
			if (value === null) {
				return;
			}
			if (typeof value !== "string" || !URL.canParse(value.trim()) || !/^https?:$/.test(new URL(value.trim()).protocol)) {
				throw new BadRequest(`The ${key} setting must be a valid DSN URL or null.`);
			}
		} else if (key === "sentry_enabled" || key.endsWith("_enabled")) {
			if (typeof value !== "boolean") {
				throw new BadRequest(`The ${key} setting must be a boolean.`);
			}
		}
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
