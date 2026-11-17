import { Controller, logger } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { MailService } from "../auth/mailService.js";
import { MailDeliveryService } from "./mailDeliveryService.js";
import { MailDomainService } from "./mailDomainService.js";
import { MailInboundService } from "./mailInboundService.js";
import { MailMessageService } from "./mailMessageService.js";
import { MailboxService } from "./mailboxService.js";
import {
	CreateMailboxRequest,
	CreateMailDomainRequest,
	PreviewMailTemplateRequest,
	SaveMailTemplateRequest,
	SendMailRequest,
	SendTestMailRequest,
	UpdateMailboxRequest,
	UpdateMailDomainRequest,
	UpdateMailSettingsRequest,
} from "./mailRequests.js";
import { MailSettingsService } from "./mailSettingsService.js";
import { MailTemplateService, templateVariables } from "./mailTemplateService.js";

function sendFile(ctx: PlatformContext, filename: string, size: number) {
	const safeName = filename.replace(/[^\w.\- ]/g, "_");
	ctx.response.setHeader("Content-Type", "application/octet-stream");
	ctx.response.setHeader("Content-Length", String(size));
	ctx.response.setHeader("Content-Disposition", `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
	ctx.response.setHeader("X-Content-Type-Options", "nosniff");
	ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
	ctx.response.setHeader("Cache-Control", "private, no-store");
}

@Controller("/admin/mail")
@Security("BearerAuth")
export class AdminMailController {
	constructor(
		private readonly authService: AuthService,
		private readonly settings: MailSettingsService,
		private readonly domains: MailDomainService,
		private readonly mailboxes: MailboxService,
		private readonly messages: MailMessageService,
		private readonly delivery: MailDeliveryService,
		private readonly inbound: MailInboundService,
		private readonly templates: MailTemplateService,
		private readonly mailService: MailService,
	) {}

	@Get("/status")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const [settings, domains, sender] = await Promise.all([this.settings.get(), this.domains.list(), this.delivery.systemSender()]);
		return {
			inbound: this.inbound.getStatus(),
			outboundReady: sender !== null,
			sender: sender?.address ?? null,
			domains: { total: domains.length, verified: domains.filter((domain) => domain.verified).length },
			userAddressesEnabled: settings.userAddressesEnabled,
		};
	}

	@Get("/settings")
	async getSettings(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.settings.get();
	}

	@Put("/settings")
	async updateSettings(@BodyParams() body: UpdateMailSettingsRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const updated = await this.settings.update(body);
		if (updated.userAddressesEnabled && updated.userAddressDomain) {
			void this.mailboxes.generateForAllUsers().catch((error) => logger().warn("Could not generate user addresses.", error));
		}
		return updated;
	}

	@Post("/diagnostics")
	async diagnostics(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.delivery.diagnostics();
	}

	@Get("/domains")
	async listDomains(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.domains.list();
	}

	@Post("/domains")
	async createDomain(@BodyParams() body: CreateMailDomainRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.domains.create(body.domain, body.allowSubdomains === true);
	}

	@Patch("/domains/:id")
	async updateDomain(@PathParams("id") id: string, @BodyParams() body: UpdateMailDomainRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.domains.update(id, body);
	}

	@Post("/domains/:id/verify")
	async verifyDomain(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.domains.verify(id);
	}

	@Post("/domains/:id/rotate-dkim")
	async rotateDkim(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.domains.rotateDkim(id);
	}

	@Delete("/domains/:id")
	async removeDomain(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.domains.remove(id);
		return { deleted: true };
	}

	@Get("/mailboxes")
	async listMailboxes(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.mailboxes.list();
	}

	@Post("/mailboxes")
	async createMailbox(@BodyParams() body: CreateMailboxRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.mailboxes.create(body);
	}

	@Post("/mailboxes/generate-user-addresses")
	async generateUserAddresses(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.mailboxes.generateForAllUsers();
	}

	@Patch("/mailboxes/:id")
	async updateMailbox(@PathParams("id") id: string, @BodyParams() body: UpdateMailboxRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.mailboxes.update(id, body);
	}

	@Delete("/mailboxes/:id")
	async removeMailbox(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.mailboxes.remove(id);
		return { deleted: true };
	}

	@Get("/messages")
	async listMessages(
		@HeaderParams("authorization") authorization?: string,
		@QueryParams("mailboxId", String) mailboxId?: string,
		@QueryParams("direction", String) direction?: string,
		@QueryParams("search", String) search?: string,
		@QueryParams("unread", Boolean) unread?: boolean,
		@QueryParams("page", Number) page?: number,
		@QueryParams("limit", Number) limit?: number,
	) {
		await this.authService.requireAdmin(authorization);
		return this.messages.list({
			mailboxId,
			direction: direction === "inbound" || direction === "outbound" ? direction : undefined,
			search,
			unreadOnly: unread === true,
			page,
			limit,
		});
	}

	@Get("/messages/:id")
	async getMessage(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const message = await this.messages.get(id);
		if (message.direction === "inbound" && !message.read) await this.messages.markRead(id);
		return { ...message, read: true };
	}

	@Delete("/messages/:id")
	async removeMessage(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.messages.remove(id);
		return { deleted: true };
	}

	@Get("/messages/:id/attachments/:attachmentId")
	async attachment(
		@PathParams("id") id: string,
		@PathParams("attachmentId") attachmentId: string,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		const { info, stream, size } = await this.messages.attachment(id, attachmentId);
		sendFile(ctx, info.filename, size);
		return stream;
	}

	@Post("/send")
	async send(@BodyParams() body: SendMailRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const mailbox = await this.mailboxes.findByAddress(body.from.trim().toLowerCase());
		if (!mailbox || mailbox.kind === "system" || !mailbox.enabled) throw new BadRequest("Send from one of the inboxes you created.");
		const rows = await this.delivery.enqueue({
			from: { address: mailbox.address, name: mailbox.displayName ?? undefined },
			to: body.to,
			subject: body.subject,
			text: body.text,
			html: body.html ?? null,
			inReplyTo: body.inReplyTo ?? null,
		});
		return { queued: rows.length, ids: rows.map((row) => row.id) };
	}

	@Get("/templates")
	async listTemplates(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.templates.list();
	}

	@Get("/templates/:name")
	async getTemplate(@PathParams("name") name: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.templates.get(name);
	}

	@Put("/templates/:name")
	async saveTemplate(@PathParams("name") name: string, @BodyParams() body: SaveMailTemplateRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.templates.save(name, body);
	}

	@Delete("/templates/:name")
	async removeTemplate(@PathParams("name") name: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.templates.remove(name);
		return { deleted: true };
	}

	@Post("/templates/:name/preview")
	async previewTemplate(@PathParams("name") name: string, @BodyParams() body: PreviewMailTemplateRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const variables = templateVariables(body.html, body.subject, body.text);
		const values = { ...this.templates.sampleValues(name, variables), ...(body.variables ?? {}) };
		return { variables, ...this.templates.renderTemplate(body, values) };
	}

	@Post("/templates/:name/test")
	async testTemplate(@PathParams("name") name: string, @BodyParams() body: SendTestMailRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const template = await this.templates.get(name);
		const rendered = this.templates.renderTemplate(template, this.templates.sampleValues(name, template.variables));
		if (!(await this.mailService.isConfigured())) throw new BadRequest("Set up the built-in mail server or an SMTP host first.");
		try {
			await this.mailService.send({ to: body.to.trim(), subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text }, { wait: true });
		} catch (error) {
			throw new BadRequest(`Could not send the test email: ${error instanceof Error ? error.message : "unknown error"}`);
		}
		return { sentTo: body.to.trim() };
	}
}

/** The signed-in user's own address and received mail. Users can read and delete, never send. */
@Controller("/mail")
@Security("BearerAuth")
export class UserMailController {
	constructor(
		private readonly authService: AuthService,
		private readonly settings: MailSettingsService,
		private readonly mailboxes: MailboxService,
		private readonly messages: MailMessageService,
	) {}

	private async mailboxFor(authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const settings = await this.settings.get();
		if (!settings.userAddressesEnabled) throw new NotFound("Email addresses aren't enabled on this server.");
		const mailbox = await this.mailboxes.ensureUserMailbox(user);
		if (!mailbox) throw new NotFound("Your email address isn't available yet.");
		return mailbox;
	}

	@Get("/me")
	async me(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const settings = await this.settings.get();
		if (!settings.userAddressesEnabled) return { enabled: false, address: null, unread: 0 };
		const mailbox = await this.mailboxes.ensureUserMailbox(user);
		if (!mailbox) return { enabled: true, address: null, unread: 0 };
		const { total } = await this.messages.list({ mailboxId: mailbox.id, direction: "inbound", unreadOnly: true, limit: 1 });
		return { enabled: true, address: mailbox.address, unread: total };
	}

	@Get("/messages")
	async list(
		@HeaderParams("authorization") authorization?: string,
		@QueryParams("search", String) search?: string,
		@QueryParams("unread", Boolean) unread?: boolean,
		@QueryParams("page", Number) page?: number,
		@QueryParams("limit", Number) limit?: number,
	) {
		const mailbox = await this.mailboxFor(authorization);
		return this.messages.list({ mailboxId: mailbox.id, direction: "inbound", search, unreadOnly: unread === true, page, limit });
	}

	@Get("/messages/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const mailbox = await this.mailboxFor(authorization);
		const scope = { mailboxId: mailbox.id, direction: "inbound" as const };
		const message = await this.messages.get(id, scope);
		if (!message.read) await this.messages.markRead(id, scope);
		return { ...message, read: true };
	}

	@Delete("/messages/:id")
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const mailbox = await this.mailboxFor(authorization);
		await this.messages.remove(id, { mailboxId: mailbox.id, direction: "inbound" });
		return { deleted: true };
	}

	@Get("/messages/:id/attachments/:attachmentId")
	async attachment(
		@PathParams("id") id: string,
		@PathParams("attachmentId") attachmentId: string,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		const mailbox = await this.mailboxFor(authorization);
		const { info, stream, size } = await this.messages.attachment(id, attachmentId, { mailboxId: mailbox.id, direction: "inbound" });
		sendFile(ctx, info.filename, size);
		return stream;
	}
}
