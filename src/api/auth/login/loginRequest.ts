import { MaxLength, MinLength, Pattern, Property, Required } from "@tsed/schema";

export class LoginRequest {

	@Property()
	@Required()
	@MinLength(3)
	@MaxLength(64)
	@Pattern(/^[a-zA-Z0-9_.-]+$/)
	username!: string;

	@Property()
	@Required()
	@MaxLength(128)
	password!: string;
}
