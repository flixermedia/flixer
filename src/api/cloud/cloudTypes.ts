export interface CloudPlan {
	id: string;
	name: string;
	status: string;
	kind: "subscription" | "one_time";
	active: boolean;
	cancelAtPeriodEnd: boolean;
	currentPeriodEnd: string | null;
	features?: string[];
}

export interface CloudAccount {
	uid: string;
	email: string;
	displayName: string;
}

export interface CloudEntitlementStatus {
	connected: boolean;
	stale: boolean;
	autoSyncEnabled: boolean;
	gracePeriodDays: number;
	instanceId: string | null;
	account: CloudAccount | null;
	linkId: string | null;
	plans: CloudPlan[];
	features: string[];
	syncedAt: string | null;
	lastSyncAttemptAt: string | null;
	lastError: string | null;
	cloudWebUrl: string;
}

export interface StoredCloudLinkState {
	linkId: string;
	accessTokenEncrypted: string;
	refreshTokenEncrypted: string;
	accessTokenExpiresAt: number;
	entitlementsTokenEncrypted?: string;
	account: CloudAccount | null;
	plans: CloudPlan[];
	features?: string[];
	syncedAt: string | null;
	lastSyncAttemptAt: string | null;
	lastError: string | null;
}
