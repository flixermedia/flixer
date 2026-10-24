import { CollectionOf, Format, MaxItems, MaxLength, MinLength, Nullable, Property, Required } from "@tsed/schema";

/** A custom message from an administrator. Without `userIds` it goes to every user. */
export class SendNotificationRequest {

	@Required()
	@MinLength(1)
	@MaxLength(120)
	title!: string;

	@Required()
	@MinLength(1)
	@MaxLength(500)
	body!: string;

	/** In-app path such as `/media/<id>`; must start with a single slash. */
	@Property()
	@Nullable(String)
	@MaxLength(300)
	url?: string | null;

	@CollectionOf(String)
	@MaxItems(1000)
	userIds?: string[];
}

export class PushKeysRequest {

	@Required()
	@MaxLength(256)
	p256dh!: string;

	@Required()
	@MaxLength(128)
	auth!: string;
}

export class PushSubscriptionRequest {

	@Required()
	@Format("uri")
	@MaxLength(1024)
	endpoint!: string;

	@Required()
	keys!: PushKeysRequest;
}

export class PushUnsubscribeRequest {

	@Required()
	@MaxLength(1024)
	endpoint!: string;
}

export class MarkReadRequest {

	@CollectionOf(String)
	@MaxItems(100)
	ids?: string[];
}
