import { MaxLength, Property, Required } from "@tsed/schema";

export class VerifyEmailRequest {

	@Property()
	@Required()
	@MaxLength(1024)
	token!: string;
}
