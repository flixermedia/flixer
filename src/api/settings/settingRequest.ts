import { Property, Required } from "@tsed/schema";

export class SettingRequest {

	@Property()
	@Required()
	value!: unknown;
}
