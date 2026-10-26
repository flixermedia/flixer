import { CollectionOf, MaxItems, MaxLength, Property, Required } from "@tsed/schema";

export class StartChatRequest {
	/** A username starts a direct conversation. Leave it out and give `name` and `usernames` to create a group. */
	@Property()
	@MaxLength(64)
	username?: string;

	@Property()
	@MaxLength(60)
	name?: string;

	@Property()
	@CollectionOf(String)
	@MaxItems(50)
	usernames?: string[];
}

export class SendMessageRequest {
	@Required()
	@MaxLength(2000)
	body!: string;
}

export class RenameChatRequest {
	@Required()
	@MaxLength(60)
	name!: string;
}

export class AddMembersRequest {
	@Required()
	@CollectionOf(String)
	@MaxItems(50)
	usernames!: string[];
}
