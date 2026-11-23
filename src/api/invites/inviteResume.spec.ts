import { describe, expect, it, vi } from "vitest";
import { Unauthorized } from "@tsed/exceptions";
import type { DataSource } from "typeorm";
import type { Invitation } from "../../entities/invitation.entity.js";
import type { InvitationUsage } from "../../entities/invitationUsage.entity.js";
import type { User } from "../../entities/user.entity.js";
import type { AuthService } from "../auth/authService.js";
import type { PaymentsService } from "../payments/paymentsService.js";
import type { InviteFulfillmentService } from "./inviteFulfillmentService.js";
import { InviteRedemptionService } from "./inviteRedemptionService.js";
import type { InvitesService } from "./invitesService.js";
import * as plexOAuth from "./plexOAuth.js";

vi.mock("../../config/store/appConfig.js", () => ({
	appConfig: () => ({
		get: (key: string) => (key === "appSecret" ? "test-app-secret-that-is-over-32-bytes-long" : undefined),
	}),
}));

function buildHarness(options: { invitation: Invitation; users?: User[]; usages?: InvitationUsage[]; signupPending?: boolean; cardRequired?: boolean; verificationRequired?: boolean; passwordMatches?: boolean }) {
	const users = options.users ?? [];
	const usages = options.usages ?? [];
	const saveUsage = vi.fn().mockImplementation(async (usage: InvitationUsage) => usage);

	const dataSource = {
		getRepository: (target: { name?: string }) => {
			if (target.name === "User") {
				return {
					findOneBy: async (where: Partial<User>) => users.find((u) => (where.username ? u.username === where.username : true) && (where.email ? u.email === where.email : true)) ?? null,
				};
			}
			if (target.name === "InvitationUsage") {
				return {
					findOne: async ({ where }: { where: Partial<InvitationUsage> }) => usages.find((u) => (where.invitationId ? u.invitationId === where.invitationId : true) && (where.userId ? u.userId === where.userId : true)) ?? null,
					find: async ({ where }: { where: Partial<InvitationUsage> }) => usages.filter((u) => (where.userId ? u.userId === where.userId : true)),
					existsBy: async ({ invitationId }: { invitationId: string }) => usages.some((u) => u.invitationId === invitationId),
					save: saveUsage,
				};
			}
			throw new Error(`Unexpected repository ${target.name}`);
		},
	} as unknown as DataSource;

	const invites = {
		findActiveByCode: vi.fn().mockResolvedValue(options.invitation),
		consume: vi.fn().mockResolvedValue(options.invitation),
		release: vi.fn().mockResolvedValue(undefined),
	} as unknown as InvitesService;

	const auth = {
		verifyUserPassword: vi.fn().mockResolvedValue(options.passwordMatches ?? false),
		verifyCredentialsByIdentifier: vi.fn().mockImplementation(async (identifier: string) => {
			const normalized = identifier.trim().toLowerCase();
			const user = users.find((u) => u.username === normalized || u.email === normalized);
			if (!user || !(options.passwordMatches ?? false)) {
				throw new Unauthorized("Invalid username or password.");
			}
			return user;
		}),
		isEmailVerificationRequired: vi.fn().mockResolvedValue(options.verificationRequired ?? false),
		issueInviteVerificationResendToken: vi.fn().mockReturnValue("resend-token-123"),
		resendInviteVerification: vi.fn().mockResolvedValue({ sent: true }),
		issueAuthResult: vi.fn().mockImplementation(async (user: User) => ({
			accessToken: `jwt-${user.id}`,
			tokenType: "Bearer",
			expiresIn: 3600,
			session: { id: "sess-1", expiresAt: new Date("2027-01-01T00:00:00Z") },
			user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, role: user.role },
		})),
	} as unknown as AuthService;

	const payments = {
		cardRequiredForSignup: vi.fn().mockResolvedValue(options.cardRequired ?? false),
		isSignupPending: vi.fn().mockResolvedValue(options.signupPending ?? false),
		markSignupPending: vi.fn().mockResolvedValue(undefined),
		issueSignupToken: vi.fn().mockImplementation((userId: string) => `pay-token-${userId}`),
	} as unknown as PaymentsService;

	const fulfillment = {
		fulfill: vi.fn().mockResolvedValue(null),
		fulfillVerifiedForUser: vi.fn().mockResolvedValue(null),
	} as unknown as InviteFulfillmentService;

	const service = new InviteRedemptionService(dataSource, invites, auth, payments, fulfillment);
	return { service, invites, auth, payments, fulfillment, saveUsage };
}

const plexInvitation = (overrides: Partial<Invitation> = {}): Invitation =>
	({
		id: "inv-plex",
		code: "PLEX1234",
		label: "Plex Invite",
		serverId: "srv-plex",
		server: { id: "srv-plex", name: "Home Plex", type: "plex", url: "https://plex.example.com", instructions: "Enjoy!", enabled: true },
		maxUses: 1,
		usedCount: 1,
		expiresAt: null,
		disabled: false,
		libraryMode: "all",
		libraryIds: [],
		externalLibraryIds: [],
		allowDownloads: true,
		skipPayment: false,
		skipEmailVerification: false,
		disablePlexOnlineSources: true,
		userExpiresInDays: null,
		...overrides,
	}) as unknown as Invitation;

const jellyfinInvitation = (overrides: Partial<Invitation> = {}): Invitation =>
	({
		id: "inv-jf",
		code: "JELLY123",
		label: "Jellyfin Invite",
		serverId: "srv-jf",
		server: { id: "srv-jf", name: "Home Jellyfin", type: "jellyfin", url: "https://jf.example.com", instructions: null, enabled: true },
		maxUses: null,
		usedCount: 1,
		expiresAt: null,
		disabled: false,
		libraryMode: "all",
		libraryIds: [],
		externalLibraryIds: [],
		allowDownloads: true,
		skipPayment: false,
		skipEmailVerification: false,
		disablePlexOnlineSources: false,
		userExpiresInDays: null,
		...overrides,
	}) as unknown as Invitation;

describe("invite resume flow for existing users", () => {
	it("resumes Plex signup on the payment screen when the Plex user already exists and has not paid yet", async () => {
		const user = { id: "u-plex", username: "plexgal", displayName: "Plex Gal", email: "plex@example.com", emailVerifiedAt: null, disabledAt: null, role: "user" } as User;
		const usage = { id: "use-1", invitationId: "inv-plex", userId: "u-plex", status: "pending_payment", pendingCredentials: null } as InvitationUsage;
		const { service, invites, saveUsage } = buildHarness({
			invitation: plexInvitation(),
			users: [user],
			usages: [usage],
			signupPending: true,
			cardRequired: true,
		});
		vi.spyOn(plexOAuth, "readPlexAuthTicket").mockReturnValue({
			inviteCode: "PLEX1234",
			plexToken: "fresh-plex-token",
			plexUsername: "plexgal",
			plexDisplayName: "Plex Gal",
			plexEmail: "plex@example.com",
		});

		const result = await service.redeemWithPlex("PLEX1234", "ticket-1");
		expect(invites.consume).not.toHaveBeenCalled();
		expect(saveUsage).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			paymentRequired: true,
			token: "pay-token-u-plex",
			destination: { type: "plex", name: "Home Plex" },
		});
	});

	it("returns verification retry screen with resend token when payment is complete but email is still unverified", async () => {
		const user = { id: "u-plex", username: "plexgal", displayName: "Plex Gal", email: "plex@example.com", emailVerifiedAt: null, disabledAt: null, role: "user" } as User;
		const usage = { id: "use-1", invitationId: "inv-plex", userId: "u-plex", status: "pending_verification", pendingCredentials: null } as InvitationUsage;
		const { service } = buildHarness({
			invitation: plexInvitation(),
			users: [user],
			usages: [usage],
			signupPending: false,
			cardRequired: true,
			verificationRequired: true,
		});
		vi.spyOn(plexOAuth, "readPlexAuthTicket").mockReturnValue({
			inviteCode: "PLEX1234",
			plexToken: "fresh-plex-token",
			plexUsername: "plexgal",
			plexDisplayName: "Plex Gal",
			plexEmail: "plex@example.com",
		});

		const result = await service.redeemWithPlex("PLEX1234", "ticket-1");
		expect(result).toMatchObject({
			verificationRequired: true,
			email: "plex@example.com",
			resendToken: "resend-token-123",
			destination: { type: "plex", name: "Home Plex" },
		});
	});

	it("returns the after-signup wizard auth result when payment is complete and email is verified", async () => {
		const user = { id: "u-plex", username: "plexgal", displayName: "Plex Gal", email: "plex@example.com", emailVerifiedAt: new Date(), disabledAt: null, role: "user" } as User;
		const usage = { id: "use-1", invitationId: "inv-plex", userId: "u-plex", status: "completed", pendingCredentials: null } as InvitationUsage;
		const { service } = buildHarness({
			invitation: plexInvitation(),
			users: [user],
			usages: [usage],
			signupPending: false,
			cardRequired: true,
			verificationRequired: true,
		});
		vi.spyOn(plexOAuth, "readPlexAuthTicket").mockReturnValue({
			inviteCode: "PLEX1234",
			plexToken: "fresh-plex-token",
			plexUsername: "plexgal",
			plexDisplayName: "Plex Gal",
			plexEmail: "plex@example.com",
		});

		const result = await service.redeemWithPlex("PLEX1234", "ticket-1");
		expect(result).toMatchObject({
			accessToken: "jwt-u-plex",
			destination: { type: "plex", name: "Home Plex" },
		});
	});

	it("shows the payment screen directly when Jellyfin/Emby/Flixer user already exists and username + password match", async () => {
		const user = { id: "u-jf", username: "sam", displayName: "Sam", email: "sam@example.com", emailVerifiedAt: null, disabledAt: null, role: "user" } as User;
		const usage = { id: "use-2", invitationId: "inv-jf", userId: "u-jf", status: "pending_payment", pendingCredentials: null } as InvitationUsage;
		const { service, invites } = buildHarness({
			invitation: jellyfinInvitation(),
			users: [user],
			usages: [usage],
			signupPending: true,
			cardRequired: true,
			passwordMatches: true,
		});

		const result = await service.redeem("JELLY123", {
			username: "sam",
			password: "correct-password",
			email: "sam@example.com",
		});
		expect(invites.consume).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			paymentRequired: true,
			token: "pay-token-u-jf",
			destination: { type: "jellyfin", name: "Home Jellyfin" },
		});
	});

	it("prompts the invite login screen when an existing Jellyfin/Emby/Flixer account has non-matching username or password", async () => {
		const user = { id: "u-jf", username: "sam", displayName: "Sam", email: "sam@example.com", emailVerifiedAt: null, disabledAt: null, role: "user" } as User;
		const { service, invites } = buildHarness({
			invitation: jellyfinInvitation(),
			users: [user],
			signupPending: true,
			cardRequired: true,
			passwordMatches: false,
		});

		const result = await service.redeem("JELLY123", {
			username: "sam",
			password: "wrong-password",
			email: "sam@example.com",
		});
		expect(invites.consume).not.toHaveBeenCalled();
		expect(result).toEqual({
			accountExists: true,
			destination: { type: "jellyfin", name: "Home Jellyfin", url: "https://jf.example.com", instructions: null, invitedByEmail: false },
		});
	});

	it("resumes to payment, verification retry, or done wizard from the invite login screen", async () => {
		const user = { id: "u-jf", username: "sam", displayName: "Sam", email: "sam@example.com", emailVerifiedAt: null, disabledAt: null, role: "user" } as User;
		const usage = { id: "use-2", invitationId: "inv-jf", userId: "u-jf", status: "pending_payment", pendingCredentials: null } as InvitationUsage;
		const unpaid = buildHarness({
			invitation: jellyfinInvitation(),
			users: [user],
			usages: [usage],
			signupPending: true,
			cardRequired: true,
			passwordMatches: true,
		});
		await expect(unpaid.service.resumeWithLogin("JELLY123", { username: "sam", password: "correct-password" })).resolves.toMatchObject({
			paymentRequired: true,
			token: "pay-token-u-jf",
		});

		const badPassword = buildHarness({
			invitation: jellyfinInvitation(),
			users: [user],
			passwordMatches: false,
		});
		await expect(badPassword.service.resumeWithLogin("JELLY123", { username: "sam", password: "nope" })).rejects.toThrow("Invalid username or password.");
	});

	it("allows describing a 1-use invite with usesRemaining: 0 when an existing usage exists so users can resume", async () => {
		const usage = { id: "use-1", invitationId: "inv-plex", userId: "u-plex", status: "pending_payment", pendingCredentials: null } as InvitationUsage;
		const { service } = buildHarness({
			invitation: plexInvitation({ maxUses: 1, usedCount: 1 }),
			usages: [usage],
			cardRequired: true,
		});

		const info = await service.describe("PLEX1234");
		expect(info.usesRemaining).toBe(0);
		expect(info.paymentRequired).toBe(true);
	});
});
