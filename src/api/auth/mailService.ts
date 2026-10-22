import { Inject, Injectable } from "@tsed/di";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";

const TEMPLATE_DIRECTORY = path.resolve(process.cwd(), "resources", "emails");
const DEFAULT_FROM = "Flixer <no-reply@localhost>";
const DEFAULT_PORT = 587;

/** Settings that make up the mail configuration; changing any of them resets the SMTP connection. */
export const SMTP_SETTING_KEYS = ["smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_password", "smtp_from"];

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
	from: string;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** Sends email through the SMTP server configured in the admin dashboard (settings table). */
@Injectable()
export class MailService {

	private transporter?: Transporter;
	private config?: SmtpConfig;

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async isConfigured(): Promise<boolean> {
		return Boolean((await this.getConfig()).host);
	}

	/** Forget the cached configuration after an SMTP setting changes. */
	reset(): void {
		this.config = undefined;
		this.transporter?.close();
		this.transporter = undefined;
	}

	async renderTemplate(name: string, values: Record<string, string>): Promise<string> {
		const template = await readFile(path.join(TEMPLATE_DIRECTORY, `${name}.html`), "utf8");
		return template.replace(/{{(\w+)}}/g, (_match, key: string) => escapeHtml(values[key] ?? ""));
	}

	async send(message: { to: string; subject: string; html: string; text: string }): Promise<void> {
		const { from } = await this.getConfig();
		await (await this.getTransporter()).sendMail({ from, ...message });
	}

	private async getConfig(): Promise<SmtpConfig> {
		if (!this.config) {
			const settings = await this.dataSource.getRepository(Setting).findBy({ key: In(SMTP_SETTING_KEYS) });
			const values = new Map(settings.map((setting) => [setting.key, setting.value]));
			const port = Number(values.get("smtp_port"));

			this.config = {
				host: text(values.get("smtp_host")),
				port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
				secure: values.get("smtp_secure") === true,
				user: text(values.get("smtp_user")),
				password: typeof values.get("smtp_password") === "string" ? (values.get("smtp_password") as string) : "",
				from: text(values.get("smtp_from")) || DEFAULT_FROM,
			};
		}

		return this.config;
	}

	private async getTransporter(): Promise<Transporter> {
		if (!this.transporter) {
			const config = await this.getConfig();
			this.transporter = nodemailer.createTransport({
				host: config.host,
				port: config.port,
				secure: config.secure,
				auth: config.user ? { user: config.user, pass: config.password } : undefined,
			});
		}

		return this.transporter;
	}
}
