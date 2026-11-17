import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, MaxLength, Post, Property, Put, Required, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { JobScheduler } from "../../jobs/jobScheduler.js";
import { isAdminScheduledTaskId } from "../../jobs/adminScheduledTasks.js";

class AdminScheduledTaskScheduleRequest {
	@Property()
	@Required()
	enabled!: boolean;

	@Property()
	@Required()
	@MaxLength(128)
	cron!: string;
}

@Controller("/admin/scheduled-tasks")
@Security("BearerAuth")
export class AdminScheduledTasksController {
	constructor(
		private readonly authService: AuthService,
		private readonly jobScheduler: JobScheduler,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return { tasks: await this.jobScheduler.getAdminTasks() };
	}

	@Put("/:id")
	async saveSchedule(
		@PathParams("id") id: string,
		@BodyParams() request: AdminScheduledTaskScheduleRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		if (!isAdminScheduledTaskId(id)) throw new BadRequest("Unknown scheduled task.");
		await this.jobScheduler.saveAdminTaskSchedule(id, request);
		return { id, enabled: request.enabled, cron: request.cron };
	}

	@Post("/:id/run")
	async run(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.runAdminTask(id);
	}

	@Post("/:id/stop")
	async stop(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.stopAdminTask(id);
	}
}
