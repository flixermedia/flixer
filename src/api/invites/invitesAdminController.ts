import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Controller, Inject } from "@tsed/di";
import { Forbidden, NotFound } from "@tsed/exceptions";
import { Delete, Get, Patch, Post, Returns, Security } from "@tsed/schema";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { syncExternalInviteAccounts } from "../../jobs/inviteSyncJob.js";
import { AuthService } from "../auth/authService.js";
import { PaymentsService } from "../payments/paymentsService.js";
import { CreateInvitationRequest, CreateInviteServerRequest, UpdateInvitationRequest, UpdateInviteServerRequest } from "./inviteRequests.js";
import { InvitesService } from "./invitesService.js";

/** Invitation management for the admin dashboard. */
@Controller("/admin/invites")
@Security("BearerAuth")
export class InvitesAdminController {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
		private readonly invites: InvitesService,
		private readonly payments: PaymentsService,
	) {}

	// ---- Media servers -------------------------------------------------------------------------------------------

	@Get("/servers")
	async listServers(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.listServers();
	}

	@Post("/servers")
	async createServer(@BodyParams() request: CreateInviteServerRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.createServer(request);
	}

	@Patch("/servers/:id")
	async updateServer(@PathParams("id") id: string, @BodyParams() request: UpdateInviteServerRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.updateServer(this.parseId(id, "Media server not found."), request);
	}

	@Post("/servers/:id/test")
	async testServer(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.testServer(this.parseId(id, "Media server not found."));
	}

	@Delete("/servers/:id")
	@Returns(204)
	async deleteServer(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		await this.invites.deleteServer(this.parseId(id, "Media server not found."));
	}

	// ---- Invitations ---------------------------------------------------------------------------------------------

	@Get("/")
	async listInvitations(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.listInvitations();
	}

	@Post("/")
	async createInvitation(@BodyParams() request: CreateInvitationRequest, @HeaderParams("authorization") authorization?: string) {
		// API keys act as their owner, so the invitation is attributed to that administrator.
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		if (user.role !== "admin") {
			throw new Forbidden("Administrator access is required.");
		}
		return this.invites.createInvitation(request, user.id);
	}

	@Patch("/:id")
	async updateInvitation(@PathParams("id") id: string, @BodyParams() request: UpdateInvitationRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.updateInvitation(this.parseId(id, "Invitation not found."), request);
	}

	@Delete("/:id")
	@Returns(204)
	async deleteInvitation(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		await this.invites.deleteInvitation(this.parseId(id, "Invitation not found."));
	}

	@Get("/:id/usages")
	async listUsages(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.listUsages(this.parseId(id, "Invitation not found."));
	}

	@Post("/sync")
	async syncExternalUsers(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return syncExternalInviteAccounts(this.dataSource, (userId) => this.payments.purgeUser(userId));
	}

	@Get("/linked-accounts")
	async listAllLinkedAccounts(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.listAllLinkedAccounts();
	}

	@Get("/users/:userId/linked-accounts")
	async listUserLinkedAccounts(@PathParams("userId") userId: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.invites.listLinkedAccountsForUser(this.parseId(userId, "User not found."));
	}

	private parseId(id: string, message: string): string {
		if (!AuthService.isUuid(id)) {
			throw new NotFound(message);
		}
		return id.toLowerCase();
	}
}
