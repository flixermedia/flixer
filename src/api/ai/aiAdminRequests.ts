import { Enum, Integer, Maximum, Minimum, Property, Required } from "@tsed/schema";

export class UpdateAiConfigurationRequest {
	@Property()
	@Required()
	enabled!: boolean;

	@Property()
	@Required()
	@Enum("auto", "classic", "micro", "mini")
	profile!: "auto" | "classic" | "micro" | "mini";

	@Property()
	@Required()
	allowDownloads!: boolean;

	@Property()
	@Required()
	@Integer()
	@Minimum(1)
	@Maximum(1440)
	cacheRefreshIntervalMinutes!: number;
}
