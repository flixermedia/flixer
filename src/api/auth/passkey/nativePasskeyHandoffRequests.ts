import { Any, MaxLength, MinLength, Pattern, Property, Required } from "@tsed/schema";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export class NativePasskeyHandoffStartRequest {

	@Property()
	@Required()
	@MinLength(43)
	@MaxLength(43)
	@Pattern(BASE64URL_PATTERN)
	codeChallenge!: string;

	@Property()
	@Required()
	@MinLength(16)
	@MaxLength(64)
	@Pattern(BASE64URL_PATTERN)
	state!: string;

	@Property()
	@MaxLength(1024)
	ticket?: string;
}

export class NativePasskeyHandoffIdRequest {

	@Property()
	@Required()
	@MinLength(43)
	@MaxLength(43)
	@Pattern(BASE64URL_PATTERN)
	handoffId!: string;
}

export class NativePasskeyHandoffVerifyRequest extends NativePasskeyHandoffIdRequest {

	@Any()
	@Required()
	response!: Record<string, unknown>;
}

export class NativePasskeyHandoffExchangeRequest {

	@Property()
	@Required()
	@MinLength(43)
	@MaxLength(43)
	@Pattern(BASE64URL_PATTERN)
	code!: string;

	@Property()
	@Required()
	@MinLength(43)
	@MaxLength(128)
	@Pattern(BASE64URL_PATTERN)
	codeVerifier!: string;

	@Property()
	@Required()
	@MinLength(16)
	@MaxLength(64)
	@Pattern(BASE64URL_PATTERN)
	state!: string;
}
