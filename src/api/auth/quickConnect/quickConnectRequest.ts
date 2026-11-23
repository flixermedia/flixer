import { Format, MaxLength, MinLength, Pattern, Property, Required } from "@tsed/schema";

export class QuickConnectPollRequest {

	@Property()
	@Required()
	@Format("uuid")
	requestId!: string;

	@Property()
	@Required()
	@MinLength(40)
	@MaxLength(64)
	pollToken!: string;
}

export class QuickConnectDecisionRequest {

	@Property()
	@Required()
	@MinLength(8)
	@MaxLength(9)
	@Pattern("^(?:[23456789A-HJ-NP-Za-hj-np-z]{8}|[23456789A-HJ-NP-Za-hj-np-z]{4}-[23456789A-HJ-NP-Za-hj-np-z]{4})$")
	userCode!: string;
}
