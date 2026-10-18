import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { tryCatch } from "@dschz/try-catch";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
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
	) {}

	/** Verification is enforced only when a mail server is configured. */
	isRequired(): boolean {
		return this.mailService.isConfigured();
	}

	async sendVerificationEmail(user: User, targetEmail?: string): Promise<void> {
		const recipient = targetEmail ?? user.email;
		if (!recipient) {
			throw new BadRequest("This account has no email address.");
		}

		const displayName = user.displayName ?? user.username;
		const verifyUrl = `${this.getAppUrl()}/verify-email?token=${encodeURIComponent(this.createToken(user, recipient))}`;
		const html = await this.mailService.renderTemplate("verify-email", {
			displayName,
			verifyUrl,
			expiresIn: "24 hours",
		});

		await this.mailService.send({
			to: recipient,
			subject: "Verify your Flixer email",
			html,
			text: `Welcome, ${displayName}.\n\nConfirm your email address to finish setting up your Flixer account (link expires in 24 hours):\n${verifyUrl}\n\nDidn't create a Flixer account? You can safely ignore this email.`,
		});
	}

	async verify(token: string): Promise<{ verified: true }> {
		const payload = this.readToken(token);
		const repository = this.dataSource.getRepository(User);
		const user = await repository.findOneBy({ id: payload.sub });
		if (!user) {
			throw new NotFound("Account not found.");
		}
		if (user.pendingEmail && user.pendingEmail === payload.email) {
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

		return { verified: true };
	}

	private getAppUrl(): string {
		return (process.env.APP_URL?.trim() || "https://localhost:5173").replace(/\/+$/, "");
	}

	private sign(value: string): Buffer {
		const secret = process.env.JWT_SECRET;
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
