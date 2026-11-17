import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { AddIssueReportUpdateRequest, CreateIssueReportRequest, SetIssueReportChatRequest, UpdateIssueReportStatusRequest } from "./issueReportRequests.js";
import { IssueReportsService } from "./issueReportsService.js";

/** Issue reports belonging to the signed-in user. */
@Controller("/issues")
@Security("BearerAuth")
export class IssueReportsController {
	constructor(
		private readonly authService: AuthService,
		private readonly issues: IssueReportsService,
	) {}

	@Get("/config")
	configuration() {
		return this.issues.configuration();
	}

	@Get("/")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.issues.mine(authorization);
	}

	@Post("/")
	@Returns(201)
	create(@BodyParams() request: CreateIssueReportRequest, @HeaderParams("authorization") authorization?: string) {
		return this.issues.create(authorization, request);
	}

	@Get("/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.issues.userDetail(id, user);
	}
}

/** Administrative issue report queue and ticket actions. */
@Controller("/admin/issues")
@Security("BearerAuth")
export class AdminIssueReportsController {
	constructor(private readonly issues: IssueReportsService) {}

	@Get("/")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.issues.adminList(authorization);
	}

	@Get("/:id")
	get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.issues.adminDetail(id, authorization);
	}

	@Delete("/:id")
	@Returns(204)
	delete(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.issues.deleteClosed(id, authorization);
	}

	@Patch("/:id/status")
	updateStatus(
		@PathParams("id") id: string,
		@BodyParams() request: UpdateIssueReportStatusRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.issues.setStatus(id, request.status, authorization);
	}

	@Post("/:id/updates")
	addUpdate(
		@PathParams("id") id: string,
		@BodyParams() request: AddIssueReportUpdateRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.issues.addUpdate(id, request.body, request.isInternal, authorization);
	}

	@Patch("/:id/chat")
	setChat(
		@PathParams("id") id: string,
		@BodyParams() request: SetIssueReportChatRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.issues.setChat(id, request.open, authorization);
	}
}
