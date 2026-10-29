import { Injectable, logger } from "@tsed/di";
import { createClient, type RedisClientType } from "redis";
import { appConfig } from "../config/store/appConfig.js";

export const PARTY_EVENTS_CHANNEL = "flixer:parties:events";

@Injectable()
export class PartyRedisService {
	private client?: RedisClientType;
	private subscriber?: RedisClientType;

	async start(onMessage: (message: string) => void): Promise<void> {
		if (this.client && this.subscriber) {
			return;
		}
		const url = appConfig().get("redisUrl");
		if (!url) {
			throw new Error("Redis is required for party synchronization. Configure REDIS_URL or finish Redis setup.");
		}

		const client = createClient({ url });
		const subscriber = client.duplicate();
		client.on("error", (error) =>
			logger().error({
				event: "PARTY_REDIS_ERROR",
				message: `Party Redis command connection failed: ${error.message}`,
			}),
		);
		subscriber.on("error", (error) =>
			logger().error({
				event: "PARTY_REDIS_SUBSCRIBER_ERROR",
				message: `Party Redis subscriber failed: ${error.message}`,
			}),
		);

		try {
			await client.connect();
			await subscriber.connect();
			await subscriber.subscribe(PARTY_EVENTS_CHANNEL, onMessage);
		} catch (error) {
			await Promise.allSettled([
				client.isOpen ? client.quit() : Promise.resolve(),
				subscriber.isOpen ? subscriber.quit() : Promise.resolve(),
			]);
			throw new Error("Could not initialize Redis for party synchronization.", { cause: error });
		}

		this.client = client;
		this.subscriber = subscriber;
	}

	get commands(): RedisClientType {
		if (!this.client?.isReady) {
			throw new Error("Party Redis is not connected.");
		}
		return this.client;
	}

	async stop(): Promise<void> {
		const clients = [this.client, this.subscriber].filter((client): client is RedisClientType => !!client);
		this.client = undefined;
		this.subscriber = undefined;
		await Promise.all(clients.map((client) => (client.isOpen ? client.quit() : Promise.resolve())));
	}
}
