import { MaxLength, MinLength, Property, Required } from "@tsed/schema";

export class LoggerConfigurationRequest {
	@Property()
	@Required()
	@MaxLength(2048)
	endpoint!: string;

	@Property()
	@Required()
	@MinLength(32)
	@MaxLength(1024)
	manageToken!: string;
}

export class LoggerSeverityRetention {
	@Property()
	trace?: number;

	@Property()
	debug?: number;

	@Property()
	info?: number;

	@Property()
	warn?: number;

	@Property()
	error?: number;

	@Property()
	fatal?: number;
}

export class LoggerRetentionRequest {
	@Property()
	@Required()
	enabled!: boolean;

	@Property()
	@Required()
	days!: number;

	@Property()
	severityDays?: LoggerSeverityRetention;
}

export class LoggerIngestionPolicyRequest {
	@Property()
	@Required()
	eventsPerSecond!: number;

	@Property()
	@Required()
	burst!: number;

	@Property()
	credentialEventsPerSecond?: number;

	@Property()
	credentialBurst?: number;

	@Property()
	serviceEventsPerSecond?: number;

	@Property()
	serviceBurst?: number;
}

export class LoggerQuotaRequest {
	@Property()
	@Required()
	maxBytes!: number;
}

export class LoggerOwnerConfigurationRequest {
	@Property()
	@Required()
	@MinLength(32)
	@MaxLength(1024)
	ownerToken!: string;
}

export class LoggerPairingRequest {
	@Property()
	@Required()
	@MaxLength(2048)
	endpoint!: string;

	@Property()
	@Required()
	@MaxLength(128)
	deploymentId!: string;

	@Property()
	@Required()
	@MinLength(43)
	@MaxLength(43)
	pairingToken!: string;
}

export class LoggerOwnerPairingRequest {
	@Property()
	@Required()
	@MaxLength(128)
	deploymentId!: string;

	@Property()
	@Required()
	minutes!: number;

	@Property()
	@Required()
	managementDays!: number;
}

export class LoggerCapacityPolicyRequest {
	@Property()
	@Required()
	maxDatabaseBytes!: number;

	@Property()
	@Required()
	minFreeBytes!: number;
}
