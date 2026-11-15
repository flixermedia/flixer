import { Enum, MaxLength, MinLength, Nullable, Property, Required } from "@tsed/schema";

export class CreateVideoCollectionRequest {
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Property()
	@Nullable(String)
	@MaxLength(500)
	description?: string | null;

	@Property()
	isPublic?: boolean;
}

export class UpdateVideoCollectionRequest {
	@Property()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@Property()
	@Nullable(String)
	@MaxLength(500)
	description?: string | null;

	@Property()
	isPublic?: boolean;
}

export class UserMediaItemRequest {
	@Required()
	@MaxLength(36)
	itemId!: string;
}

export class RecommendationFeedbackRequest {
	@Required()
	@Enum("dismiss", "more_like_this", "less_like_this")
	feedback!: "dismiss" | "more_like_this" | "less_like_this";
}