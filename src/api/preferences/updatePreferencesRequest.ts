import { AdditionalProperties, array, Integer, Nullable, Property, Required, Schema } from "@tsed/schema";

export class DashboardGridItemRequest {

	@Property()
	@Required()
	id!: string;

	@Property()
	@Required()
	@Integer()
	x!: number;

	@Property()
	@Required()
	@Integer()
	y!: number;

	@Property()
	@Required()
	@Integer()
	w!: number;

	@Property()
	@Required()
	@Integer()
	h!: number;
}

/** Partial preference update; a `null` value removes that key. */
@AdditionalProperties(true)
export class UpdatePreferencesRequest {

	@Property()
	@Nullable(String)
	language?: string | null;

	@Schema(array(DashboardGridItemRequest).nullable())
	adminDashboardGrid?: DashboardGridItemRequest[] | null;

	@Property()
	@Schema({ type: ["null", "integer"], minimum: 2, maximum: 8 } as never)
	browseColumns?: number | null;

	@Property()
	@Nullable(Boolean)
	autoSkipIntroCredits?: boolean | null;

	[key: string]: unknown;
}
