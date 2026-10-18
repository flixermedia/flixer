import { Injectable } from "@tsed/di";
import type { User } from "../../entities/user.entity.js";
import { MailService } from "./mailService.js";

@Injectable()
export class AccountEmailService {

	constructor(private readonly mailService: MailService) {}

	/** Best effort: a mail failure must never undo an account deletion. */
	async sendAccountDeletedEmail(user: Pick<User, "username" | "displayName" | "email">): Promise<void> {
		if (!user.email || !this.mailService.isConfigured()) {
			return;
		}

		const displayName = user.displayName ?? user.username;
		const appUrl = (process.env.APP_URL?.trim() || "https://localhost:5173").replace(/\/+$/, "");
		const deletedAt = new Date().toUTCString();

		try {
			const html = await this.mailService.renderTemplate("account-deleted", {
				displayName,
				username: user.username,
				deletedAt,
				appUrl,
			});
			await this.mailService.send({
				to: user.email,
				subject: "Your Flixer account was deleted",
				html,
				text: `Goodbye, ${displayName}.\n\nYour Flixer account "${user.username}" was permanently deleted on ${deletedAt}. Your passkeys and sessions have been removed.\n\nDidn't delete your account? Contact your server administrator right away.`,
			});
		} catch (error: unknown) {
			console.error("[mail] failed to send account deleted email", error);
		}
	}
}
