import { MaxLength, MinLength, Property, Required } from "@tsed/schema";

export class ScheduleJobRequest {

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(128)
	cron!: string;

	@Property()
	data?: Record<string, unknown>;
}
