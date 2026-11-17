import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { EnqueueJobRequest } from "./enqueueJobRequest.js";
import { ScheduleJobRequest } from "./scheduleJobRequest.js";
import { JobScheduler } from "../../jobs/jobScheduler.js";

@Controller("/jobs")
@Security("BearerAuth")
export class JobsController {

	constructor(
		private readonly authService: AuthService,
		private readonly jobScheduler: JobScheduler,
	) {}

	@Get("/queues")
	async getQueues(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.getQueues();
	}

	@Get("/queues/:queueName/jobs")
	async findJobs(
		@PathParams("queueName") queueName: string,
		@QueryParams("limit", Number) limit?: number,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.findJobs(queueName, limit);
	}

	@Get("/queues/:queueName/jobs/:jobId")
	async getJob(
		@PathParams("queueName") queueName: string,
		@PathParams("jobId") jobId: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.getJob(queueName, jobId);
	}

	@Post("/queues/:queueName/jobs")
	async enqueue(
		@PathParams("queueName") queueName: string,
		@BodyParams() request: EnqueueJobRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return { id: await this.jobScheduler.enqueue(queueName, request.data) };
	}

	@Post("/queues/:queueName/jobs/:jobId/retry")
	async retryJob(
		@PathParams("queueName") queueName: string,
		@PathParams("jobId") jobId: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.retryJob(queueName, jobId);
	}

	@Delete("/queues/:queueName/jobs/:jobId")
	async cancelJob(
		@PathParams("queueName") queueName: string,
		@PathParams("jobId") jobId: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.cancelJob(queueName, jobId);
	}

	@Get("/schedules")
	async getSchedules(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.jobScheduler.getSchedules();
	}

	@Put("/schedules/:queueName")
	async schedule(
		@PathParams("queueName") queueName: string,
		@BodyParams() request: ScheduleJobRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		await this.jobScheduler.schedule(queueName, request.cron, request.data);
		return { queueName, cron: request.cron, scheduled: true };
	}

	@Delete("/schedules/:queueName")
	async unschedule(
		@PathParams("queueName") queueName: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		await this.jobScheduler.unschedule(queueName);
		return { queueName, scheduled: false };
	}
}
