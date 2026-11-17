import { Any, MaxLength, Property, Required } from "@tsed/schema";

export class PasskeySecondFactorRequest {

	@Property()
	@Required()
	@MaxLength(1024)
	ticket!: string;

	@Any()
	response?: Record<string, unknown>;
}
