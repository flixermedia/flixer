import { Optional, Property, Required } from "@tsed/schema";

export class SetPasskeyRequiredRequest {

	@Property()
	@Required()
	enabled!: boolean;

	@Property()
	@Optional()
	password?: string;
}
