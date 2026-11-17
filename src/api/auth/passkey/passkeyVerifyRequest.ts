import { Any, MaxLength, Property, Required } from "@tsed/schema";

export class PasskeyVerifyRequest {

	@Any()
	@Required()
	response!: Record<string, unknown>;

	@Property()
	@MaxLength(64)
	name?: string;
}
