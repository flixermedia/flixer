import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { appConfig } from "../../config/store/appConfig.js";
import { EmailVerificationService } from "../auth/emailVerificationService.js";
import type { MailService } from "../auth/mailService.js";
import { MailTemplateService } from "../mail/mailTemplateService.js";
import { buildInviteDestination, destinationCredentialsNote, destinationLabel, destinationOpenUrl } from "./inviteDestination.js";

describe("invite destination helpers", () => {
	it("resolves server names, URLs and credentials guidance per server type", () => {
		const jellyfin = buildInviteDestination({ serverId: "s1", server: { id: "s1", name: "Jellyfin", type: "jellyfin", url: "http://172.16.0.20:8096", externalUrl: "https://jf.example.com", instructions: "Install Jellyfin" } as never });
		const plex = buildInviteDestination({ serverId: "s2", server: { id: "s2", name: "Plex", type: "plex", url: "https://plex.example.com", externalUrl: null, instructions: null } as never }, true);
		const plexWithExternal = buildInviteDestination({ serverId: "s2", server: { id: "s2", name: "Plex", type: "plex", url: "http://172.16.0.31:32400", externalUrl: "https://plex.gitcloud.org", instructions: null } as never }, false);
		const plexFallback = buildInviteDestination({ serverId: "s2", server: { id: "s2", name: "Plex", type: "plex", url: "", externalUrl: "   ", instructions: null } as never }, true);
		const emby = buildInviteDestination({ serverId: "s3", server: { id: "s3", name: "", type: "emby", url: "https://emby.example.com", externalUrl: null, instructions: null } as never });
		const flixer = buildInviteDestination({ serverId: null, server: null });

		expect(destinationLabel(jellyfin)).toBe("Jellyfin");
		expect(jellyfin.url).toBe("https://jf.example.com");
		expect(destinationOpenUrl(jellyfin, "https://flixer.example.com")).toBe("https://jf.example.com");
		expect(destinationCredentialsNote(jellyfin)).toContain("username and password");

		expect(destinationLabel(plex)).toBe("Plex");
		expect(plex.url).toBe("https://plex.example.com");
		expect(destinationOpenUrl(plex, "https://flixer.example.com")).toBe("https://plex.example.com");
		expect(plexWithExternal.url).toBe("https://plex.gitcloud.org");
		expect(destinationOpenUrl(plexWithExternal, "https://flixer.example.com")).toBe("https://plex.gitcloud.org");
		expect(destinationOpenUrl(plexFallback, "https://flixer.example.com")).toBe("https://app.plex.tv");
		expect(destinationCredentialsNote(plex)).toContain("Plex sent an invitation");

		expect(destinationLabel(emby)).toBe("Emby");
		expect(destinationOpenUrl(emby, "https://flixer.example.com")).toBe("https://emby.example.com");

		expect(destinationLabel(flixer, "MyFlixer")).toBe("MyFlixer");
		expect(destinationOpenUrl(flixer, "https://flixer.example.com")).toBe("https://flixer.example.com");
	});
});

describe("invite email templates", () => {
	it("renders invite-verify-email, invite-purchase-receipt and invite-welcome built-in templates", async () => {
		const templates = new MailTemplateService();

		const verify = await templates.render("invite-verify-email", {
			displayName: "Alex",
			username: "alex",
			verifyUrl: "https://flixer.example.com/verify-email?token=abc",
			expiresIn: "24 hours",
			serverName: "Jellyfin",
			serverType: "jellyfin",
			serverUrl: "https://jf.example.com",
			instructions: "",
		});
		expect(verify.subject).toBe("Verify your email for Jellyfin");
		expect(verify.html).toContain("finish setting up your Jellyfin account");
		expect(verify.text).toContain("Jellyfin");

		const receipt = await templates.render("invite-purchase-receipt", {
			displayName: "Alex",
			kind: "Account access",
			title: "Plex access",
			detail: "",
			lines: "Plex access: £5.00",
			subtotal: "£5.00",
			discount: "",
			discountLabel: "Discount",
			tax: "",
			total: "£5.00",
			orderId: "ABCDEF12",
			date: "Sat, 21 Nov 2026",
			watchUrl: "https://app.plex.tv",
			watchLabel: "Open Plex",
			serverName: "Plex",
			serverType: "plex",
			serverUrl: "https://app.plex.tv",
			instructions: "Accept your Plex share email.",
		});
		expect(receipt.subject).toBe("Your Plex receipt: Plex access");
		expect(receipt.html).toContain("PAYMENT RECEIVED");
		expect(receipt.html).toContain("Open Plex");
		expect(receipt.html).toContain("https://app.plex.tv");
		expect(receipt.html).toContain("Accept your Plex share email.");

		const welcome = await templates.render("invite-welcome", {
			displayName: "Alex",
			username: "alex",
			serverName: "Emby",
			serverType: "emby",
			serverUrl: "https://emby.example.com",
			watchLabel: "Open Emby",
			instructions: "Use Emby Theater",
			credentialsNote: "Sign in with the username and password you chose when accepting the invitation.",
		});
		expect(welcome.subject).toBe("Welcome to Emby");
		expect(welcome.html).toContain("Open Emby");
		expect(welcome.html).toContain("https://emby.example.com");
		expect(welcome.html).toContain("Use Emby Theater");
	});
});

describe("EmailVerificationService for invites", () => {
	it("sends invite-verify-email for invited users and returns destination + sends welcome on initial verify", async () => {
		const secretSpy = vi.spyOn(appConfig(), "get").mockImplementation((key) => {
			if (key === "jwtSecret") return "0123456789abcdef0123456789abcdef";
			if (key === "appUrl") return "https://flixer.example.com";
			if (key === "passkeyRpName") return "Flixer";
			return undefined;
		});

		try {
			const user = { id: "u1", username: "alex", displayName: "Alex", email: "alex@example.com", pendingEmail: null, emailVerifiedAt: null as Date | null };
			const usage = {
				userId: "u1",
				externalEmail: null,
				invitation: {
					serverId: "s1",
					server: { id: "s1", name: "Jellyfin", type: "jellyfin", url: "https://jf.example.com", instructions: "Download Jellyfin" },
				},
			};

			const userRepo = { findOneBy: vi.fn().mockResolvedValue(user), save: vi.fn().mockResolvedValue(user) };
			const usageRepo = { findOne: vi.fn().mockResolvedValue(usage) };
			const dataSource = {
				getRepository: (entity: { name?: string }) => (entity?.name === "InvitationUsage" ? usageRepo : userRepo),
			} as unknown as DataSource;

			const renderMessage = vi.fn().mockResolvedValue({ subject: "Sub", html: "<p>Hi</p>", text: "Hi" });
			const send = vi.fn().mockResolvedValue(undefined);
			const mailService = { isConfigured: vi.fn().mockResolvedValue(true), renderMessage, send } as unknown as MailService;

			const inviteFulfillment = { fulfillVerifiedForUser: vi.fn().mockResolvedValue(null) };
			const service = new EmailVerificationService(dataSource, mailService, inviteFulfillment as never);
			await service.sendVerificationEmail(user as never);

			expect(renderMessage).toHaveBeenCalledWith(
				"invite-verify-email",
				expect.objectContaining({
					displayName: "Alex",
					username: "alex",
					serverName: "Jellyfin",
					serverType: "jellyfin",
					serverUrl: "https://jf.example.com",
					instructions: "Download Jellyfin",
				}),
			);

			const verifyUrl = (renderMessage.mock.calls[0]?.[1] as { verifyUrl: string }).verifyUrl;
			const token = new URL(verifyUrl).searchParams.get("token")!;
			renderMessage.mockClear();
			send.mockClear();

			const verified = await service.verify(token);
			expect(verified).toEqual({
				verified: true,
				destination: { type: "jellyfin", name: "Jellyfin", url: "https://jf.example.com", instructions: "Download Jellyfin", invitedByEmail: false },
			});
			expect(renderMessage).toHaveBeenCalledWith(
				"invite-welcome",
				expect.objectContaining({
					serverName: "Jellyfin",
					serverUrl: "https://jf.example.com",
					watchLabel: "Open Jellyfin",
				}),
			);
			expect(send).toHaveBeenCalledOnce();

			// Clicking the same link a second time still returns the destination without resending the welcome email.
			renderMessage.mockClear();
			send.mockClear();
			const verifiedAgain = await service.verify(token);
			expect(verifiedAgain.destination?.name).toBe("Jellyfin");
			expect(send).not.toHaveBeenCalled();

			// Profile email changes still use the standard verify-email template.
			renderMessage.mockClear();
			await service.sendVerificationEmail(user as never, "new@example.com");
			expect(renderMessage).toHaveBeenCalledWith("verify-email", expect.objectContaining({ displayName: "Alex" }));
		} finally {
			secretSpy.mockRestore();
		}
	});
});
