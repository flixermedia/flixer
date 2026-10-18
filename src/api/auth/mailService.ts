import { Injectable } from "@tsed/di";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

const TEMPLATE_DIRECTORY = path.resolve(process.cwd(), "resources", "emails");

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

@Injectable()
export class MailService {

	private transporter?: Transporter;

	isConfigured(): boolean {
		return Boolean(process.env.SMTP_HOST?.trim());
	}

	async renderTemplate(name: string, values: Record<string, string>): Promise<string> {
		const template = await readFile(path.join(TEMPLATE_DIRECTORY, `${name}.html`), "utf8");
		return template.replace(/{{(\w+)}}/g, (_match, key: string) => escapeHtml(values[key] ?? ""));
	}

	async send(message: { to: string; subject: string; html: string; text: string }): Promise<void> {
		await this.getTransporter().sendMail({
			from: process.env.MAIL_FROM?.trim() || "Flixer <no-reply@localhost>",
			...message,
		});
	}

	private getTransporter(): Transporter {
		if (!this.transporter) {
			const user = process.env.SMTP_USER?.trim();
			this.transporter = nodemailer.createTransport({
				host: process.env.SMTP_HOST?.trim(),
				port: Number(process.env.SMTP_PORT) || 587,
				secure: process.env.SMTP_SECURE?.trim().toLowerCase() === "true",
				auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
			});
		}

		return this.transporter;
	}
}
