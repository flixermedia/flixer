import { AdditionalProperties } from "@tsed/schema";

/** Partial preference map; a `null` value removes that key. Keys are validated in PreferencesService. */
@AdditionalProperties(true)
export class UpdatePreferencesRequest {
	[key: string]: unknown;
}
