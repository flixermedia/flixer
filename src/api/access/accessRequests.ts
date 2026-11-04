import { MaxLength, Property, Required } from "@tsed/schema";

export class UnlockRequest {

	@Property()
	@Required()
	@MaxLength(8)
	pin!: string;
}
