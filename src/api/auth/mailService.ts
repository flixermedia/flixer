import { Inject, Injectable } from "@tsed/di";
import nodemailer, { type Transporter } from "nodemailer";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { MailDeliveryService } from "../mail/mailDeliveryService.js";
import { MailTemplateService, type RenderedMail } from "../mail/mailTemplateService.js";

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

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** Sends email through the SMTP server configured in the admin dashboard (settings table). */
@Injectable()
export class MailService {

	private transporter?: Transporter;
	private config?: SmtpConfig;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly templates: MailTemplateService,
		private readonly delivery: MailDeliveryService,
	) {
		this.delivery.setRelay((message) => this.sendViaRelay(message));
	}

	/** True when either Flixer's built-in mail server or an external SMTP relay can send mail. */
	async isConfigured(): Promise<boolean> {
		return (await this.delivery.systemSender()) !== null || (await this.isRelayConfigured());
	}

	async isRelayConfigured(): Promise<boolean> {
		return Boolean((await this.getConfig()).host);
	}

	/** Forget the cached configuration after an SMTP setting changes. */
	reset(): void {
		this.config = undefined;
		this.transporter?.close();
		this.transporter = undefined;
	}

	/** Renders a template (custom copy in DATA_DIR/emails first, then the built-in default). */
	renderMessage(name: string, values: Record<string, string>): Promise<RenderedMail> {
		return this.templates.render(name, values);
	}

	async send(message: { to: string; subject: string; html: string; text: string }, options: { wait?: boolean } = {}): Promise<void> {
		const sender = await this.delivery.systemSender();
		if (sender) {
			await this.delivery.enqueue({ from: sender, to: [message.to], subject: message.subject, html: message.html, text: message.text, system: true, wait: options.wait });
			return;
		}
		await this.sendViaRelay(message);
	}

	private async sendViaRelay(message: { to: string; subject: string; html: string; text: string }): Promise<void> {
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
