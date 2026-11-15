import { Enum, MaxLength, MinLength, Property, Required } from "@tsed/schema";

export class CreateNetworkShareRequest {

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(255)
	host!: string;

	@Property()
	@Required()
	@MinLength(1)
	@MaxLength(255)
	share!: string;

	@Property()
	@Enum("smb", "nfs", "webdav", "s3")
	protocol?: "smb" | "nfs" | "webdav" | "s3";

	@Property()
	@MaxLength(255)
	username?: string;

	@Property()
	@MaxLength(64)
	domain?: string;

	@Property()
	@MaxLength(64)
	region?: string;

	@Property()
	@MaxLength(512)
	password?: string;

	@Property()
	readOnly?: boolean;
}

export class UpdateNetworkShareRequest {

	@Property()
	@Enum("smb", "nfs", "webdav", "s3")
	protocol?: "smb" | "nfs" | "webdav" | "s3";

	@Property()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@Property()
	@MinLength(1)
	@MaxLength(255)
	host?: string;

	@Property()
	@MinLength(1)
	@MaxLength(255)
	share?: string;

	@Property()
	@MaxLength(255)
	username?: string;

	@Property()
	@MaxLength(64)
	domain?: string;

	@Property()
	@MaxLength(64)
	region?: string;

	/** Omit to keep the saved password; send an empty string to remove it. */
	@Property()
	@MaxLength(512)
	password?: string;

	@Property()
	readOnly?: boolean;
}
