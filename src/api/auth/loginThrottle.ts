import { DEFAULT_LOGIN_SECURITY, type LoginSecurityConfig } from "./loginSecurity.js";

const MAX_BUCKETS = 10_000;

interface Bucket {
	count: number;
	until: number;
}

export class LoginThrottle {
	private readonly addresses = new Map<string, Bucket>();
	private readonly usernames = new Map<string, Bucket>();

	reserve(address: string, username: string, now = Date.now(), config: LoginSecurityConfig = DEFAULT_LOGIN_SECURITY): number | (() => void) {
		const windowMs = config.windowSeconds * 1000;
		const addressBucket = this.bucket(this.addresses, address, now, windowMs);
		if (!addressBucket) return config.windowSeconds;
		if (addressBucket.count >= config.ipLimit) {
			const existingUsername = this.usernames.get(username);
			const blockedUntil = Math.max(addressBucket.until, existingUsername && existingUsername.count >= config.usernameLimit ? existingUsername.until : now);
			return Math.max(1, Math.ceil((blockedUntil - now) / 1000));
		}
		const usernameBucket = this.bucket(this.usernames, username, now, windowMs);
		if (!usernameBucket) return config.windowSeconds;
		if (usernameBucket.count >= config.usernameLimit) return Math.max(1, Math.ceil((usernameBucket.until - now) / 1000));
		addressBucket.count++;
		usernameBucket.count++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			addressBucket.count--;
			usernameBucket.count--;
		};
	}

	clear(): void {
		this.addresses.clear();
		this.usernames.clear();
	}

	private bucket(buckets: Map<string, Bucket>, key: string, now: number, windowMs: number): Bucket | undefined {
		const existing = buckets.get(key);
		if (existing && existing.until > now) return existing;
		if (!existing && buckets.size >= MAX_BUCKETS) {
			for (const [bucketKey, bucket] of buckets) {
				if (bucket.until <= now) buckets.delete(bucketKey);
			}
			if (buckets.size >= MAX_BUCKETS) return undefined;
		}
		const created = { count: 0, until: now + windowMs };
		buckets.set(key, created);
		return created;
	}
}