import { getContext, Injectable } from "@tsed/di";
import { TooManyRequests } from "@tsed/exceptions";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

interface RequestContextLike {
	request?: { raw?: { ip?: string } };
}

@Injectable()
export class RateLimitService {
	private readonly policies = {
		quickConnectStart: new RateLimiterMemory({ points: 5, duration: 600 }),
		quickConnectDecision: new RateLimiterMemory({ points: 20, duration: 600 }),
	};

	async consume(policy: keyof RateLimitService["policies"], message: string): Promise<void> {
		const address = getContext<RequestContextLike>()?.request?.raw?.ip || "unknown";
		try {
			await this.policies[policy].consume(address);
		} catch (error) {
			if (error instanceof RateLimiterRes) throw new TooManyRequests(message);
			throw error;
		}
	}
}
