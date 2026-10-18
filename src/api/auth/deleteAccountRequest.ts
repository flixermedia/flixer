import { MaxLength, Property, Required } from "@tsed/schema";

export class DeleteAccountRequest {

	@Property()
	@Required()
	@MaxLength(128)
	password!: string;
}
