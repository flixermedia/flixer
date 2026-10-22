import { TooManyRequests } from "@tsed/exceptions";

/**
 * Bounds how many indexer writes run at once so a large scan cannot use up the database connections
 * the rest of flixer needs. Extra requests wait their turn; past maxQueued they are turned away with a
 * 429, which flixer-indexer retries with backoff.
 */
export class WorkLimiter {

	private active = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(
		private readonly maxActive: number,
		private readonly maxQueued: number,
	) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		if (this.active >= this.maxActive) {
			if (this.waiting.length >= this.maxQueued) {
				throw new TooManyRequests("flixer is busy; retry shortly.");
			}
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		} else {
			this.active++;
		}
		try {
			return await task();
		} finally {
			// A finished task hands its slot straight to the next waiter.
			const next = this.waiting.shift();
			if (next) {
				next();
			} else {
				this.active--;
			}
		}
	}
}

function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function indexerWriteLimiter(): WorkLimiter {
	return new WorkLimiter(positiveInt(process.env.INDEXER_MAX_WRITES, 3), positiveInt(process.env.INDEXER_MAX_QUEUED_WRITES, 200));
}
