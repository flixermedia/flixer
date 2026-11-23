import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { tryCatch } from "@dschz/try-catch";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { appConfig } from "../../config/store/appConfig.js";
import { destinationCredentialsNote, destinationLabel, destinationOpenUrl, findInviteDestinationForUser, type InviteDestination } from "../invites/inviteDestination.js";
import { InviteFulfillmentService } from "../invites/inviteFulfillmentService.js";
import { MailService } from "./mailService.js";

const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
const TOKEN_PURPOSE = "verify-email";

interface VerificationPayload {
	sub: string;
	email: string;
	exp: number;
	pur: string;
}

@Injectable()
export class EmailVerificationService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly mailService: MailService,
		private readonly inviteFulfillment: InviteFulfillmentService,
	) {}

	/** Verification is enforced only when the admin has it switched on and a mail server is configured. */
	async isRequired(): Promise<boolean> {
		if (!(await this.mailService.isConfigured())) {
			return false;
		}

		const setting = await this.dataSource.getRepository(Setting).findOneBy({ key: "email_verification_required" });
		return setting?.value !== false;
	}

	async sendVerificationEmail(user: User, targetEmail?: string, inviteDestination?: InviteDestination | null): Promise<void> {
		const recipient = targetEmail ?? user.email;
		if (!recipient) {
			throw new BadRequest("This account has no email address.");
		}

		const displayName = user.displayName ?? user.username;
		const appUrl = this.getAppUrl();
		const appName = this.getAppName();
		const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(this.createToken(user, recipient))}`;
		const destination = targetEmail ? null : inviteDestination !== undefined ? inviteDestination : await findInviteDestinationForUser(this.dataSource, user.id);

		const { subject, html, text } = destination
			? await this.mailService.renderMessage("invite-verify-email", {
					displayName,
					username: user.username,
					verifyUrl,
					expiresIn: "24 hours",
					serverName: destinationLabel(destination, appName),
					serverType: destination.type,
					serverUrl: destinationOpenUrl(destination, appUrl),
					instructions: destination.instructions ?? "",
				})
			: await this.mailService.renderMessage("verify-email", {
					displayName,
					verifyUrl,
					expiresIn: "24 hours",
				});

		await this.mailService.send({ to: recipient, subject, html, text });
	}

	async sendInviteWelcomeEmail(user: Pick<User, "email" | "displayName" | "username">, destination: InviteDestination): Promise<void> {
		if (!user.email || !(await this.mailService.isConfigured())) {
			return;
		}
		const appUrl = this.getAppUrl();
		const appName = this.getAppName();
		const serverName = destinationLabel(destination, appName);
		const serverUrl = destinationOpenUrl(destination, appUrl);
		const { subject, html, text } = await this.mailService.renderMessage("invite-welcome", {
			displayName: user.displayName ?? user.username,
			username: user.username,
			serverName,
			serverType: destination.type,
			serverUrl,
			watchLabel: `Open ${serverName}`,
			instructions: destination.instructions ?? "",
			credentialsNote: destinationCredentialsNote(destination),
		});
		await this.mailService.send({ to: user.email, subject, html, text });
	}

	async verify(token: string): Promise<{ verified: true; destination?: InviteDestination }> {
		const payload = this.readToken(token);
		const repository = this.dataSource.getRepository(User);
		const user = await repository.findOneBy({ id: payload.sub });
		if (!user) {
			throw new NotFound("Account not found.");
		}
		const wasPendingEmailChange = Boolean(user.pendingEmail && user.pendingEmail === payload.email);
		const wasAlreadyVerified = Boolean(user.emailVerifiedAt);
		if (wasPendingEmailChange && user.pendingEmail) {
			user.email = user.pendingEmail;
			user.pendingEmail = null;
			user.emailVerifiedAt = new Date();
		} else if (user.email === payload.email) {
			user.emailVerifiedAt ??= new Date();
		} else {
			throw new BadRequest("This verification link is no longer valid.");
		}

		const [saveError] = await tryCatch(() => repository.save(user));
		if (saveError) {
			if (typeof saveError === "object" && "driverError" in saveError) {
				throw new Conflict("An account with this email already exists.");
			}
			throw saveError;
		}

		if (!wasPendingEmailChange) {
			const activatedDestination = await this.inviteFulfillment.fulfillVerifiedForUser(user.id);
			const destination = activatedDestination ?? (await findInviteDestinationForUser(this.dataSource, user.id));
			if (destination) {
				if (!wasAlreadyVerified) {
					const [welcomeError] = await tryCatch(() => this.sendInviteWelcomeEmail(user, destination));
					if (welcomeError) {
						console.error("[auth] failed to send invite welcome email", welcomeError);
					}
				}
				return { verified: true, destination };
			}
		}

		return { verified: true };
	}

	private getAppName(): string {
		return appConfig().get("passkeyRpName") || "Flixer";
	}

	private getAppUrl(): string {
		return (appConfig().get("appUrl") || "https://localhost:5173").replace(/\/+$/, "");
	}

	private sign(value: string): Buffer {
		const secret = appConfig().get("jwtSecret");
		if (!secret || Buffer.byteLength(secret) < 32) {
			throw new Error("JWT_SECRET must be set to at least 32 bytes to issue verification tokens.");
		}

		return createHmac("sha256", secret).update(value).digest();
	}

	private createToken(user: User, email: string): string {
		const payload: VerificationPayload = {
			sub: user.id,
			email,
			exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
			pur: TOKEN_PURPOSE,
		};
		const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

		return `${body}.${this.sign(body).toString("base64url")}`;
	}

	private readToken(token: string): VerificationPayload {
		const [body, signature] = token.split(".");
		const invalid = new BadRequest("This verification link is invalid or has expired.");
		if (!body || !signature) {
			throw invalid;
		}

		const expected = this.sign(body);
		const received = Buffer.from(signature, "base64url");
		if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
			throw invalid;
		}

		const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as VerificationPayload;
		if (payload.pur !== TOKEN_PURPOSE || payload.exp < Math.floor(Date.now() / 1000)) {
			throw invalid;
		}

		return payload;
	}
}
