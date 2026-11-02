import { CollectionOf, Max, MaxItems, Min, Property } from "@tsed/schema";

export class RecommendationFiltersRequest {
	@Property()
	@CollectionOf(String)
	@MaxItems(7)
	types?: string[];

	@Property()
	@CollectionOf(String)
	@MaxItems(30)
	genres?: string[];

	@Property()
	@Min(1800)
	@Max(2200)
	year_from?: number;

	@Property()
	@Min(1800)
	@Max(2200)
	year_to?: number;
}

export class RecommendationRequest {
	@Property()
	@Min(1)
	@Max(100)
	limit?: number;

	@Property()
	filters?: RecommendationFiltersRequest;
}
