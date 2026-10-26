import { isValidVapidSubject } from "../notifications/notificationService.js";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { AuthService } from "../auth/authService.js";
import { SENTRY_SETTING_KEYS, SentryService } from "../../sentry/sentryService.js";
import { MailService, SMTP_SETTING_KEYS } from "../auth/mailService.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { IndexerSettingsService, INDEXER_SETTING_KEYS } from "../indexer/indexerSettingsService.js";
import { validateHttpUrl } from "../../config/store/configSchema.js";
import { SKIPME_API_URL_KEY } from "../media/segmentLogic.js";
import { SECRET_MASK } from "./secretMask.js";
import { REQUEST_SETTING_KEYS, validateRequestSetting } from "../requests/requestSettings.js";
import { TRANSCODING_SETTING_KEYS, validateTranscodingSetting } from "./transcodingSettings.js";
import { SettingRequest } from "./settingRequest.js";

export { SECRET_MASK };

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
		private readonly mailService: MailService,
		private readonly indexerSettings: IndexerSettingsService,
		private readonly indexerClient: IndexerClient,
	) {}

	async sendTestEmail(authorization?: string): Promise<{ sentTo: string }> {
		const { user } = await this.authService.requireAdminSession(authorization);
		if (!user.email) {
			throw new BadRequest("Add an email address to your profile to receive the test email.");
		}
		if (!(await this.mailService.isConfigured())) {
			throw new BadRequest("Save an SMTP host before sending a test email.");
		}

		try {
			await this.mailService.send({
				to: user.email,
				subject: "Flixer test email",
				html: "<p>This is a test email from your Flixer server. Your SMTP settings work.</p>",
				text: "This is a test email from your Flixer server. Your SMTP settings work.",
			});
		} catch (error: unknown) {
			throw new BadRequest(
				`Could not send the test email: ${error instanceof Error ? error.message : "unknown error"}`,
			);
		}

		return { sentTo: user.email };
	}

	async list(authorization?: string): Promise<PublicSetting[]> {
		const actor = await this.authService.getAuthenticatedUser(authorization);
		const settings = await this.dataSource.getRepository(Setting).find({
			where: actor.role === "admin" ? undefined : { isPublic: true },
			order: { key: "ASC" },
		});

		return settings.map((setting) => this.toPublicSetting(setting));
	}

	async getRegistrationStatus(): Promise<{ registrationEnabled: boolean; serverName: string; loginBanner: string }> {
		const repository = this.dataSource.getRepository(Setting);
		const setting = await repository.findOneBy({ key: "registration_enabled" });
		if (!setting || typeof setting.value !== "boolean") {
			throw new Error("The registration_enabled setting is missing or invalid.");
		}
		const text = async (key: string) => {
			const value = (await repository.findOneBy({ key }))?.value;
			return typeof value === "string" ? value : "";
		};

		return {
			registrationEnabled: setting.value,
			serverName: await text("server_name"),
			loginBanner: await text("login_banner"),
		};
	}

	async update(key: string, request: SettingRequest, authorization?: string): Promise<PublicSetting> {
		await this.authService.requireAdmin(authorization);

		if (!SETTING_KEY_PATTERN.test(key)) {
			throw new BadRequest("Setting key has an invalid format.");
		}
		if (
			(key === "registration_enabled" || key === "email_verification_required") &&
			typeof request.value !== "boolean"
		) {
			throw new BadRequest(`The ${key} setting must be a boolean.`);
		}

		if (key === "login_banner" && (typeof request.value !== "string" || request.value.length > 500)) {
			throw new BadRequest("The login_banner setting must be text of at most 500 characters.");
		}
		if (
			key === "server_name" &&
			request.value !== null &&
			(typeof request.value !== "string" || request.value.length > 100)
		) {
			throw new BadRequest("The server_name setting must be text of at most 100 characters.");
		}

		if (key === SKIPME_API_URL_KEY) {
			const url = typeof request.value === "string" ? request.value.trim() : null;
			if (url === null || (url !== "" && validateHttpUrl(url))) {
				throw new BadRequest("The skipme_api_url setting must be empty or an http(s) URL.");
			}
		}

		if (TRANSCODING_SETTING_KEYS.includes(key)) {
			validateTranscodingSetting(key, request.value);
		}

		if (key === "notifications_enabled" || key === "notifications_new_media_enabled") {
			if (typeof request.value !== "boolean") {
				throw new BadRequest(`The ${key} setting must be a boolean.`);
			}
		}
		if (key === "notifications_permission_prompt" && request.value !== "button" && request.value !== "load") {
			throw new BadRequest('The notifications_permission_prompt setting must be "button" or "load".');
		}
		if (
			key === "notifications_vapid_subject" &&
			(typeof request.value !== "string" ||
				(request.value.trim() !== "" && !isValidVapidSubject(request.value.trim())))
		) {
			throw new BadRequest("The VAPID subject must be empty, a mailto: address or an https:// URL.");
		}

		if ((REQUEST_SETTING_KEYS as readonly string[]).includes(key)) {
			validateRequestSetting(key, request.value);
		}

		if (key === "themes_enabled" && typeof request.value !== "boolean") {
			throw new BadRequest("The themes_enabled setting must be a boolean.");
		}

		if (key === "updates_state") {
			throw new BadRequest("The update state is managed by Flixer.");
		}
		if (key === "updates_check_enabled" || key === "updates_auto_update") {
			if (typeof request.value !== "boolean") {
				throw new BadRequest(`The ${key} setting must be a boolean.`);
			}
		}
		if (key === "updates_updater_url") {
			const value = typeof request.value === "string" ? request.value.trim() : null;
			if (value === null || (value !== "" && !/^https?:\/\/[^\s]+$/.test(value))) {
				throw new BadRequest("The updater URL must be empty or an http(s) URL.");
			}
		}

		if (key === "backups_state") {
			throw new BadRequest("The backup state is managed by Flixer.");
		}
		if (
			key === "backups_schedule" &&
			request.value !== "off" &&
			request.value !== "daily" &&
			request.value !== "weekly"
		) {
			throw new BadRequest('The backups_schedule setting must be "off", "daily" or "weekly".');
		}
		if (
			key === "backups_keep" &&
			(typeof request.value !== "number" ||
				!Number.isInteger(request.value) ||
				request.value < 1 ||
				request.value > 60)
		) {
			throw new BadRequest("The backups_keep setting must be a whole number from 1 to 60.");
		}

		if (key.startsWith("sentry_")) {
			this.validateSentrySetting(key, request.value);
		}

		if (SMTP_SETTING_KEYS.includes(key)) {
			this.validateSmtpSetting(key, request.value);
		}

		const settings = this.dataSource.getRepository(Setting);
		const setting = await settings.findOneBy({ key });
		if (!setting) {
			throw new NotFound("Setting not found. Add new settings through a database migration.");
		}

		setting.value = INDEXER_SETTING_KEYS.includes(key)
			? this.indexerSettings.validate(key, request.value, setting.value)
			: request.value;
		const saved = await settings.save(setting);
		if (SENTRY_SETTING_KEYS.includes(key)) {
			await this.sentryService.apply();
		}
		if (SMTP_SETTING_KEYS.includes(key)) {
			this.mailService.reset();
		}
		if (INDEXER_SETTING_KEYS.includes(key)) {
			await this.indexerClient.reloadSettings();
		}

		return this.toPublicSetting(saved);
	}

	private validateSentrySetting(key: string, value: unknown): void {
		if (key.endsWith("_dsn")) {
			if (value === null) {
				return;
			}
			if (
				typeof value !== "string" ||
				!URL.canParse(value.trim()) ||
				!/^https?:$/.test(new URL(value.trim()).protocol)
			) {
				throw new BadRequest(`The ${key} setting must be a valid DSN URL or null.`);
			}
		} else if (key === "sentry_enabled" || key.endsWith("_enabled")) {
			if (typeof value !== "boolean") {
				throw new BadRequest(`The ${key} setting must be a boolean.`);
			}
		}
	}

	private validateSmtpSetting(key: string, value: unknown): void {
		if (key === "smtp_secure") {
			if (typeof value !== "boolean") {
				throw new BadRequest("The smtp_secure setting must be a boolean.");
			}
		} else if (key === "smtp_port") {
			if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
				throw new BadRequest("The smtp_port setting must be a port number between 1 and 65535.");
			}
		} else if (typeof value !== "string" || value.length > 512) {
			throw new BadRequest(`The ${key} setting must be text up to 512 characters.`);
		} else if (key === "smtp_password" && value === SECRET_MASK) {
			throw new BadRequest("Enter the new SMTP password instead of the masked placeholder.");
		}
	}

	private toPublicSetting(setting: Setting): PublicSetting {
		const isSecret = setting.key === "smtp_password";
		return {
			key: setting.key,
			value: isSecret
				? setting.value
					? SECRET_MASK
					: ""
				: this.indexerSettings.mask(setting.key, setting.value),
			isPublic: setting.isPublic,
			updatedAt: setting.updatedAt,
		};
	}
}
