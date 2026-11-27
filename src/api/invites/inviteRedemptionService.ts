import { BadGateway, BadRequest, Forbidden, NotFound } from "@tsed/exceptions";
import { Inject, Injectable, logger } from "@tsed/di";
import { randomBytes, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Invitation } from "../../entities/invitation.entity.js";
import { InvitationUsage } from "../../entities/invitationUsage.entity.js";
import { User } from "../../entities/user.entity.js";
import { UserAccessPolicy } from "../../entities/userAccessPolicy.entity.js";
import { AuthService, type AuthResult, type PaymentPending, type VerificationPending } from "../auth/authService.js";
import { PaymentsService } from "../payments/paymentsService.js";
import { InviteFulfillmentService, decryptPendingCredentials, encryptPendingCredentials, type LinkedServiceOutcome, type PendingInviteCredentials } from "./inviteFulfillmentService.js";
import { buildInviteDestination, type InviteDestination } from "./inviteDestination.js";
import { InvitesService } from "./invitesService.js";
import { MediaServerError } from "./mediaServerClient.js";
import { pollPlexInviteAuth, readPlexAuthTicket, startPlexInviteAuth, type PlexAuthPollResult, type PlexAuthStartResult } from "./plexOAuth.js";
import type { AcceptInvitationRequest, LoginInvitationRequest } from "./inviteRequests.js";

export type { InviteDestination } from "./inviteDestination.js";

export interface PublicInviteService {
	id: string;
	type: InviteDestination["type"];
	name: string | null;
}

export interface PublicInvitation {
	code: string;
	label: string | null;
	destination: { type: InviteDestination["type"]; name: string | null };
	services: PublicInviteService[];
	paymentRequired: boolean;
	expiresAt: Date | null;
	usesRemaining: number | null;
}

export interface InviteAccountExists {
	accountExists: true;
	existingUsername?: string;
}

export type RedemptionResult = (AuthResult | VerificationPending | PaymentPending | InviteAccountExists) & {
	destination: InviteDestination;
	services?: PublicInviteService[];
	linkedServices?: LinkedServiceOutcome[];
	plexPending?: boolean;
};

@Injectable()
export class InviteRedemptionService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly invites: InvitesService,
		private readonly auth: AuthService,
		private readonly payments: PaymentsService,
		private readonly fulfillment: InviteFulfillmentService,
	) {}

	private targetServers(invitation: Invitation) {
		if (typeof this.invites.resolveTargetServers === "function") {
			return this.invites.resolveTargetServers(invitation);
		}
		return invitation.serverId && invitation.server ? [invitation.server] : [];
	}

	private buildPublicServices(invitation: Invitation): PublicInviteService[] {
		const targets = this.targetServers(invitation);
		const services: PublicInviteService[] = targets.map((s) => ({
			id: s.id,
			type: s.type,
			name: s.name,
		}));
		if (invitation.includeFlixer ?? true) {
			services.unshift({ id: "flixer", type: "flixer", name: null });
		}
		return services;
	}

	private hasPlexTarget(invitation: Invitation): boolean {
		return this.targetServers(invitation).some((s) => s.type === "plex");
	}

	private hasNonPlexServices(invitation: Invitation): boolean {
		const hasNonPlexTarget = this.targetServers(invitation).some((s) => s.type !== "plex");
		return hasNonPlexTarget || (invitation.includeFlixer ?? true);
	}

	/** What a visitor opening the invite link may know before signing up. */
	async describe(code: string): Promise<PublicInvitation> {
		const invitation = await this.invites.findActiveByCode(code);
		if (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now()) {
			throw new NotFound("This invite has expired.");
		}
		const usesRemaining = invitation.maxUses === null ? null : Math.max(0, invitation.maxUses - invitation.usedCount);
		if (usesRemaining === 0) {
			const hasExistingUsage = await this.dataSource.getRepository(InvitationUsage).existsBy({ invitationId: invitation.id });
			if (!hasExistingUsage) {
				throw new NotFound("This invite has already been used.");
			}
		}
		const targets = this.targetServers(invitation);
		const primary = targets[0] ?? invitation.server ?? null;
		return {
			code: invitation.code,
			label: invitation.label,
			destination: {
				type: primary?.type ?? "flixer",
				name: primary?.name ?? null,
			},
			services: this.buildPublicServices(invitation),
			paymentRequired: await this.paymentRequired(invitation),
			expiresAt: invitation.expiresAt,
			usesRemaining,
		};
	}

	/** Starts a Wizarr-style Plex OAuth PIN window for an invitation that includes a Plex server. */
	async startPlexAuth(code: string): Promise<PlexAuthStartResult> {
		const invitation = await this.invites.findActiveByCode(code);
		if (!this.hasPlexTarget(invitation)) {
			throw new BadRequest("This invitation does not use Plex sign-in.");
		}
		try {
			return await startPlexInviteAuth(invitation.code);
		} catch (error) {
			if (error instanceof MediaServerError) {
				throw new BadGateway(error.message);
			}
			throw error;
		}
	}

	/** Polls Plex for the PIN's completion and returns an encrypted ticket + account summary once authorised. */
	async pollPlexAuth(code: string, sessionToken: string): Promise<PlexAuthPollResult> {
		const invitation = await this.invites.findActiveByCode(code);
		if (!this.hasPlexTarget(invitation)) {
			throw new BadRequest("This invitation does not use Plex sign-in.");
		}
		try {
			return await pollPlexInviteAuth(invitation.code, sessionToken);
		} catch (error) {
			if (error instanceof MediaServerError) {
				throw new BadGateway(error.message);
			}
			throw error;
		}
	}

	/** Redeems a Plex invitation (or Step 2 of a multi-service invite) using the Plex OAuth ticket. */
	async redeemWithPlex(code: string, plexAuthTicket: string, authorization?: string): Promise<RedemptionResult> {
		const ticket = readPlexAuthTicket(code, plexAuthTicket);
		const invitation = await this.invites.findActiveByCode(code);
		if (!this.hasPlexTarget(invitation)) {
			throw new BadRequest("This invitation does not use Plex sign-in.");
		}

		// If the user already authenticated in Step 1 of a multi-service invite, link Plex to that Flixer user.
		if (authorization) {
			const authedUser = await this.auth.getAuthenticatedUser(authorization).catch(() => null);
			const fullUser = authedUser ? await this.dataSource.getRepository(User).findOneBy({ id: authedUser.id }) : null;
			if (fullUser) {
				return this.linkPlexForUser(fullUser, invitation, ticket.plexEmail, ticket.plexToken);
			}
		}

		const normalizedEmail = ticket.plexEmail.trim().toLowerCase();
		const existingUser = await this.dataSource.getRepository(User).findOneBy({ email: normalizedEmail });
		if (existingUser) {
			return this.resumeExistingUser(existingUser, invitation, { email: normalizedEmail, plexUserToken: ticket.plexToken });
		}

		const consumed = await this.invites.consume(code);
		const username = await this.resolveUniqueUsername(ticket.plexUsername, ticket.plexEmail);
		const password = randomBytes(24).toString("base64url");
		return this.completeRedemption(consumed, { username, password, email: ticket.plexEmail, displayName: ticket.plexDisplayName }, ticket.plexToken);
	}

	private async linkPlexForUser(user: User, invitation: Invitation, plexEmail: string, plexUserToken: string): Promise<RedemptionResult> {
		const usage = (await this.findExistingUsage(user.id, invitation)) ?? this.dataSource.getRepository(InvitationUsage).create({
			id: randomUUID(),
			invitationId: invitation.id,
			userId: user.id,
			username: user.username,
			status: "completed",
			expiresAt: invitation.userExpiresInDays === null ? null : new Date(Date.now() + invitation.userExpiresInDays * 24 * 60 * 60 * 1000),
		});
		if (!usage.createdAt) {
			await this.dataSource.getRepository(InvitationUsage).save(usage);
		}
		const verificationRequired = !invitation.skipEmailVerification && (await this.auth.isEmailVerificationRequired()) && !user.emailVerifiedAt;
		const { primary, linkedResults } = await this.fulfillment.fulfillAll(
			usage,
			invitation,
			{ password: "", email: plexEmail || user.email || "", plexUserToken },
			{ requireVerification: verificationRequired, toleratePartialFailure: true },
		);
		const destination = buildInviteDestination(invitation, Boolean(primary?.invitedEmail && !primary.inviteAccepted));
		const authResult = await this.auth.issueAuthResult(user);
		return {
			...authResult,
			destination,
			services: this.buildPublicServices(invitation),
			linkedServices: linkedResults,
			plexPending: false,
		};
	}

	/**
	 * Redeems the invite: claims a use, creates the Flixer account (even while public registration
	 * is off), applies the invite's library access, and provisions the linked media server — right
	 * away for free signups, or once the signup payment clears for paid ones.
	 *
	 * If an account with the username or email already exists:
	 * - Matching username + password resumes the invite flow (payment, verification retry, or done wizard).
	 * - Non-matching credentials prompt the invite login screen instead of failing with a dead-end conflict.
	 */
	async redeem(code: string, request: AcceptInvitationRequest): Promise<RedemptionResult> {
		const invitation = await this.invites.findActiveByCode(code);
		const normalizedUsername = request.username.trim().toLowerCase();
		const normalizedEmail = request.email.trim().toLowerCase();
		const users = this.dataSource.getRepository(User);
		const byUsername = await users.findOneBy({ username: normalizedUsername });
		const byEmail = byUsername?.email === normalizedEmail ? byUsername : await users.findOneBy({ email: normalizedEmail });
		const existingUser = byUsername ?? byEmail;

		if (existingUser) {
			return {
				accountExists: true,
				existingUsername: existingUser.username,
				services: this.buildPublicServices(invitation),
				destination: buildInviteDestination(invitation, false),
			};
		}

		const consumed = await this.invites.consume(code);
		return this.completeRedemption(consumed, request);
	}

	/** Resumes an invitation flow for an existing account via username/email + password login. */
	async resumeWithLogin(code: string, request: LoginInvitationRequest): Promise<RedemptionResult> {
		const invitation = await this.invites.findActiveByCode(code);
		const user = await this.auth.verifyCredentialsByIdentifier(request.username, request.password);
		return this.resumeExistingUser(user, invitation, {
			password: request.password,
			email: user.email ?? "",
		});
	}

	/** Resends the invite-branded verification email using the signed resend token issued during redemption/resume. */
	async resendVerification(code: string, resendToken: string): Promise<{ sent: true }> {
		const invitation = await this.invites.findActiveByCode(code);
		return this.auth.resendInviteVerification(resendToken, buildInviteDestination(invitation, false));
	}

	private async resumeExistingUser(user: User, invitation: Invitation, credentials: { password?: string; email?: string; plexUserToken?: string }): Promise<RedemptionResult> {
		if (user.disabledAt) {
			throw new Forbidden("This account has been disabled. Contact your server administrator.");
		}

		let usage = await this.findExistingUsage(user.id, invitation);
		const signupPending = await this.payments.isSignupPending(user.id);
		const inviteRequiresPayment = await this.paymentRequired(invitation);

		if (signupPending || (usage?.status === "pending_payment" && inviteRequiresPayment)) {
			if (!signupPending) {
				await this.payments.markSignupPending(user.id);
			}
			if (usage && this.needsCredentialsLater(invitation)) {
				await this.refreshPendingCredentials(usage, credentials);
			}
			return {
				paymentRequired: true,
				token: this.payments.issueSignupToken(user.id),
				services: this.buildPublicServices(invitation),
				destination: buildInviteDestination(invitation, false),
			};
		}

		const verificationRequired = !invitation.skipEmailVerification && (await this.auth.isEmailVerificationRequired());
		if (verificationRequired && !user.emailVerifiedAt) {
			if (usage && usage.status === "pending_payment") {
				const merged = this.mergePendingCredentials(usage, credentials);
				await this.fulfillment.fulfill(usage, invitation, merged, { requireVerification: true });
			} else if (usage && usage.status === "pending_verification" && invitation.server?.type === "plex" && credentials.plexUserToken) {
				await this.refreshPendingCredentials(usage, credentials);
			}
			return {
				verificationRequired: true,
				email: user.email ?? credentials.email ?? "",
				resendToken: this.auth.issueInviteVerificationResendToken(user.id),
				services: this.buildPublicServices(invitation),
				destination: buildInviteDestination(invitation, false),
			};
		}

		let destination = buildInviteDestination(invitation, false);
		let linkedServices: LinkedServiceOutcome[] | undefined;
		const skipPlex = this.hasPlexTarget(invitation) && this.hasNonPlexServices(invitation) && !credentials.plexUserToken;

		if (!usage) {
			// Existing Flixer user redeeming a new invite (e.g. Flixer -> Jellyfin/Emby/Multi-service).
			const consumed = await this.invites.consume(invitation.code);
			usage = this.dataSource.getRepository(InvitationUsage).create({
				id: randomUUID(),
				invitationId: consumed.id,
				userId: user.id,
				username: user.username,
				status: "completed",
				expiresAt: consumed.userExpiresInDays === null ? null : new Date(Date.now() + consumed.userExpiresInDays * 24 * 60 * 60 * 1000),
			});
			await this.dataSource.getRepository(InvitationUsage).save(usage);
			const result = await this.fulfillment.fulfillAll(
				usage,
				consumed,
				{
					password: credentials.password ?? "",
					email: user.email ?? credentials.email ?? "",
					...(credentials.plexUserToken ? { plexUserToken: credentials.plexUserToken } : {}),
				},
				{ requireVerification: false, toleratePartialFailure: true, skipPlex },
			);
			linkedServices = result.linkedResults;
			destination = buildInviteDestination(consumed, Boolean(result.primary?.invitedEmail && !result.primary.inviteAccepted));
		} else if (usage.status === "pending_payment") {
			const merged = this.mergePendingCredentials(usage, credentials);
			const result = await this.fulfillment.fulfillAll(usage, invitation, merged, { requireVerification: false, toleratePartialFailure: true, skipPlex });
			linkedServices = result.linkedResults;
			destination = buildInviteDestination(invitation, Boolean(result.primary?.invitedEmail && !result.primary.inviteAccepted));
		} else if (usage.status === "pending_verification") {
			if (invitation.server?.type === "plex" && credentials.plexUserToken) {
				await this.refreshPendingCredentials(usage, credentials);
			}
			destination = (await this.fulfillment.fulfillVerifiedForUser(user.id)) ?? destination;
		} else if (this.targetServers(invitation).length > 1) {
			// Usage already exists for this invite; ensure any missing targets on a multi-service invite are provisioned.
			const result = await this.fulfillment.fulfillAll(
				usage,
				invitation,
				{
					password: credentials.password ?? "",
					email: user.email ?? credentials.email ?? "",
					...(credentials.plexUserToken ? { plexUserToken: credentials.plexUserToken } : {}),
				},
				{ requireVerification: false, toleratePartialFailure: true, skipPlex },
			);
			linkedServices = result.linkedResults;
		}

		const authResult = await this.auth.issueAuthResult(user);
		return {
			...authResult,
			destination,
			services: this.buildPublicServices(invitation),
			...(linkedServices ? { linkedServices } : {}),
			...(skipPlex ? { plexPending: true } : {}),
		};
	}

	private async findExistingUsage(userId: string, invitation: Invitation): Promise<InvitationUsage | null> {
		const repo = this.dataSource.getRepository(InvitationUsage);
		const direct = await repo.findOne({
			where: { invitationId: invitation.id, userId },
			order: { createdAt: "DESC" },
		});
		if (direct) return direct;

		if (!invitation.serverId) return null;
		const userUsages = await repo.find({
			where: { userId },
			relations: { invitation: { server: true } },
			order: { createdAt: "DESC" },
		});
		return userUsages.find((entry) => entry.invitation?.serverId === invitation.serverId) ?? null;
	}

	private mergePendingCredentials(usage: InvitationUsage, incoming: { password?: string; email?: string; plexUserToken?: string }): PendingInviteCredentials {
		let existing: Partial<PendingInviteCredentials> = {};
		if (usage.pendingCredentials) {
			try {
				existing = decryptPendingCredentials(usage.pendingCredentials);
			} catch {
				existing = {};
			}
		}
		return {
			password: incoming.password ?? existing.password ?? "",
			email: incoming.email ?? existing.email ?? "",
			...(incoming.plexUserToken || existing.plexUserToken ? { plexUserToken: incoming.plexUserToken ?? existing.plexUserToken } : {}),
		};
	}

	private async refreshPendingCredentials(usage: InvitationUsage, incoming: { password?: string; email?: string; plexUserToken?: string }): Promise<void> {
		if (!incoming.password && !incoming.plexUserToken && !incoming.email) return;
		const merged = this.mergePendingCredentials(usage, incoming);
		usage.pendingCredentials = encryptPendingCredentials(merged);
		await this.dataSource.getRepository(InvitationUsage).save(usage);
	}

	private async completeRedemption(invitation: Invitation, request: AcceptInvitationRequest, plexUserToken?: string): Promise<RedemptionResult> {
		const collectPayment = await this.paymentRequired(invitation);

		let registration: Awaited<ReturnType<AuthService["registerForInvitation"]>>;
		try {
			registration = await this.auth.registerForInvitation({ username: request.username, password: request.password, email: request.email, displayName: request.displayName }, collectPayment, {
				sendVerification: false,
				skipEmailVerification: invitation.skipEmailVerification,
			});
		} catch (error) {
			await this.invites.release(invitation.id).catch(() => undefined);
			throw error;
		}
		const { user, result } = registration;
		const verificationRequired = "verificationRequired" in result;

		const usage = this.dataSource.getRepository(InvitationUsage).create({
			id: randomUUID(),
			invitationId: invitation.id,
			userId: user.id,
			username: user.username,
			status: collectPayment ? "pending_payment" : verificationRequired ? "pending_verification" : "completed",
			pendingCredentials: collectPayment && this.needsCredentialsLater(invitation) ? encryptPendingCredentials({ password: request.password, email: user.email ?? request.email, ...(plexUserToken ? { plexUserToken } : {}) }) : null,
			expiresAt: invitation.userExpiresInDays === null ? null : new Date(Date.now() + invitation.userExpiresInDays * 24 * 60 * 60 * 1000),
		});

		try {
			await this.dataSource.getRepository(InvitationUsage).save(usage);
			if (invitation.libraryMode === "selected") {
				await this.dataSource.getRepository(UserAccessPolicy).save({
					userId: user.id,
					libraryMode: "selected",
					libraryIds: invitation.libraryIds,
				});
			}
			let invitedByEmail = false;
			let linkedServices: LinkedServiceOutcome[] | undefined;
			const skipPlex = this.hasPlexTarget(invitation) && this.hasNonPlexServices(invitation) && !plexUserToken;
			if (!collectPayment) {
				const fulfilled = await this.fulfillment.fulfillAll(
					usage,
					invitation,
					{ password: request.password, email: user.email ?? request.email, ...(plexUserToken ? { plexUserToken } : {}) },
					{ requireVerification: verificationRequired, skipPlex },
				);
				linkedServices = fulfilled.linkedResults;
				invitedByEmail = Boolean(fulfilled.primary?.invitedEmail && !fulfilled.primary.inviteAccepted);
			}
			const destination = buildInviteDestination(invitation, invitedByEmail);
			if (verificationRequired) {
				await this.auth.sendInviteVerification(user, destination);
			} else if (!collectPayment) {
				await this.auth.sendInviteWelcome(user, destination);
			}
			return {
				...result,
				destination,
				services: this.buildPublicServices(invitation),
				...(linkedServices ? { linkedServices } : {}),
				...(skipPlex ? { plexPending: true } : {}),
			};
		} catch (error) {
			await this.undoRedemption(invitation, usage, user).catch((undoError) => logger().error("Could not undo a failed invite redemption.", undoError));
			if (error instanceof MediaServerError) {
				throw new BadGateway(`Your account could not be set up on the media server. ${error.message}`);
			}
			throw error;
		}
	}

	private async resolveUniqueUsername(preferred: string, email: string): Promise<string> {
		const sanitize = (raw: string) =>
			raw
				.toLowerCase()
				.replace(/[^a-z0-9_.-]+/g, "")
				.slice(0, 56);
		let base = sanitize(preferred) || sanitize(email.split("@")[0] ?? "") || "plexuser";
		if (base.length < 3) base = `${base}user`.slice(0, 56);
		const users = this.dataSource.getRepository(User);
		if (!(await users.existsBy({ username: base }))) {
			return base;
		}
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const candidate = `${base.slice(0, 55)}-${randomBytes(3).toString("hex")}`;
			if (!(await users.existsBy({ username: candidate }))) {
				return candidate;
			}
		}
		return `plex-${randomBytes(6).toString("hex")}`;
	}

	private async paymentRequired(invitation: Invitation): Promise<boolean> {
		return !invitation.skipPayment && (await this.payments.cardRequiredForSignup());
	}

	/** Jellyfin and Emby need the chosen password once the fee clears; Plex only needs the email. */
	private needsCredentialsLater(invitation: Invitation): boolean {
		return this.targetServers(invitation).length > 0;
	}

	/** Best-effort compensation when redemption fails halfway: the account, usage and claimed use are taken back. */
	private async undoRedemption(invitation: Invitation, usage: InvitationUsage, user: User): Promise<void> {
		await this.payments.purgeUser(user.id).catch(() => undefined);
		await this.dataSource.getRepository(InvitationUsage).delete({ id: usage.id });
		await this.dataSource.getRepository(User).delete({ id: user.id });
		await this.invites.release(invitation.id);
	}
}
