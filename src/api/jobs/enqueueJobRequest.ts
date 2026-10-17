import { Property } from "@tsed/schema";

export class EnqueueJobRequest {

	@Property()
	data?: Record<string, unknown>;
}
