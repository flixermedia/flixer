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

export class ChatMlsWelcomeRecipientRequest {
	@Required()
	@MaxLength(36)
	deviceId!: string;

	@Required()
	@MaxLength(36)
	keyPackageId!: string;
}

export class ChatMlsWelcomeDeliveryRequest {
	@Required()
	@CollectionOf(ChatMlsWelcomeRecipientRequest)
	@MaxItems(200)
	recipients!: ChatMlsWelcomeRecipientRequest[];

	@Required()
	@MaxLength(32768)
	welcome!: string;

	@Required()
	@MaxLength(32768)
	ratchetTree!: string;
}

export class SendMessageRequest {
	@Required()
	@MaxLength(32768)
	body!: string;

	@Property()
	encrypted?: boolean;

	@Property()
	@MaxLength(36)
	mlsDeviceId?: string;

	@Property()
	mlsWelcome?: ChatMlsWelcomeDeliveryRequest;
}

export class RegisterChatMlsDeviceRequest {
	@Required()
	@MaxLength(80)
	name!: string;

	@Required()
	@MaxLength(36)
	deviceId!: string;

	@Required()
	@MaxLength(32768)
	keyPackage!: string;

	@Required()
	@MaxLength(512)
	pairingPublicKey!: string;
}

export class AddChatMlsKeyPackageRequest {
	@Required()
	@MaxLength(32768)
	keyPackage!: string;
}

export class ApproveChatMlsDeviceRequest {
	@Required()
	@MaxLength(36)
	approverDeviceId!: string;

	@Required()
	@MaxLength(128)
	signature!: string;
}

export class StoreChatMlsWelcomeRequest extends ChatMlsWelcomeDeliveryRequest {
	@Required()
	@MaxLength(36)
	messageId!: string;
}

export class AcknowledgeChatMlsWelcomeRequest {
	@Required()
	@MaxLength(36)
	deviceId!: string;
}

export class ChatMlsHistoryBackupRequest {
	@Required()
	@MaxLength(29000000)
	backup!: string;
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
