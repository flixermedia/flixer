import { Required, Schema } from "@tsed/schema";

export class SettingRequest {

	// @Any() would emit overlapping integer/number oneOf branches, rejecting every number.
	@Schema({ type: ["null", "number", "string", "boolean", "array", "object"] } as never)
	@Required()
	value!: unknown;
}
