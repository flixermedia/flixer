import { Injectable } from "@tsed/di";
import type { User } from "../../entities/user.entity.js";
import { appConfig } from "../../config/store/appConfig.js";
import { MailService } from "./mailService.js";

@Injectable()
export class AccountEmailService {

	constructor(private readonly mailService: MailService) {}

	/** Best effort: a mail failure must never undo an account deletion. */
	async sendAccountDeletedEmail(user: Pick<User, "username" | "displayName" | "email">): Promise<void> {
		if (!user.email || !(await this.mailService.isConfigured())) {
			return;
		}

		const displayName = user.displayName ?? user.username;
		const appUrl = (appConfig().get("appUrl") || "https://localhost:5173").replace(/\/+$/, "");
		const deletedAt = new Date().toUTCString();

		try {
			const { subject, html, text } = await this.mailService.renderMessage("account-deleted", {
				displayName,
				username: user.username,
				deletedAt,
				appUrl,
			});
			await this.mailService.send({ to: user.email, subject, html, text });
		} catch (error: unknown) {
			console.error("[mail] failed to send account deleted email", error);
		}
	}
}
