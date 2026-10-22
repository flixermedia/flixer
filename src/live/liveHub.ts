/** The data streams admins can subscribe to over the live socket. */
export const LIVE_TOPICS = ["overview", "streams", "devices", "indexer", "shares"] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];

export function isLiveTopic(value: unknown): value is LiveTopic {
	return typeof value === "string" && (LIVE_TOPICS as readonly string[]).includes(value);
}

/** Who a subscription belongs to; loaders can tailor their data to it (the devices list marks the caller's own session). */
export interface LiveContext {
	sessionId: string;
}

export interface LiveTopicDefinition {
	/** How often the data is re-read while someone is subscribed. Mutations can also call invalidate() for an instant push. */
	intervalMs: number;
	/** Gives every session its own copy of the data instead of sharing one. */
	perSession?: boolean;
	load: (context: LiveContext) => Promise<unknown>;
}

export type LiveListener = (topic: LiveTopic, data: unknown) => void;

interface Subscriber {
	context: LiveContext;
	listener: LiveListener;
}

interface Channel {
	topic: LiveTopic;
	context: LiveContext;
	subscribers: Set<Subscriber>;
	timer?: NodeJS.Timeout;
	lastJson?: string;
	running: boolean;
	rerun: boolean;
}

/**
 * Pushes topic data to subscribers when it changes. A topic is only read while at least one admin is
 * subscribed, once per interval no matter how many clients are watching, and nothing is sent when the
 * data hasn't changed.
 */
export class LiveHub {

	private readonly definitions = new Map<LiveTopic, LiveTopicDefinition>();
	private readonly channels = new Map<string, Channel>();

	define(topic: LiveTopic, definition: LiveTopicDefinition): void {
		this.definitions.set(topic, definition);
	}

	/** Starts a subscription; the current data is delivered right away. Returns the unsubscribe function. */
	subscribe(topic: LiveTopic, context: LiveContext, listener: LiveListener): () => void {
		const definition = this.definitions.get(topic);
		if (!definition) {
			throw new Error(`Unknown live topic: ${topic}`);
		}
		const key = definition.perSession ? `${topic}:${context.sessionId}` : topic;
		let channel = this.channels.get(key);
		if (!channel) {
			channel = { topic, context, subscribers: new Set(), running: false, rerun: false };
			this.channels.set(key, channel);
		}

		const subscriber: Subscriber = { context, listener };
		channel.subscribers.add(subscriber);
		if (channel.lastJson !== undefined) {
			listener(topic, JSON.parse(channel.lastJson));
		}
		if (channel.subscribers.size === 1) {
			void this.refresh(key);
		}

		return () => {
			channel.subscribers.delete(subscriber);
			if (channel.subscribers.size === 0) {
				clearTimeout(channel.timer);
				this.channels.delete(key);
			}
		};
	}

	/** Re-reads a topic now, for use after something changed it. */
	invalidate(topic: LiveTopic): void {
		for (const [key, channel] of this.channels) {
			if (channel.topic === topic) {
				void this.refresh(key);
			}
		}
	}

	close(): void {
		for (const channel of this.channels.values()) {
			clearTimeout(channel.timer);
		}
		this.channels.clear();
	}

	private async refresh(key: string): Promise<void> {
		const channel = this.channels.get(key);
		const definition = channel && this.definitions.get(channel.topic);
		if (!channel || !definition) {
			return;
		}
		if (channel.running) {
			channel.rerun = true;
			return;
		}

		channel.running = true;
		clearTimeout(channel.timer);
		try {
			const json = JSON.stringify(await definition.load(channel.context));
			if (json !== channel.lastJson && this.channels.get(key) === channel) {
				channel.lastJson = json;
				for (const subscriber of channel.subscribers) {
					subscriber.listener(channel.topic, JSON.parse(json));
				}
			}
		} catch {
			// A failed read keeps the last data on screen; the next tick tries again.
		} finally {
			channel.running = false;
			if (this.channels.get(key) === channel) {
				const delay = channel.rerun ? 0 : definition.intervalMs;
				channel.rerun = false;
				channel.timer = setTimeout(() => void this.refresh(key), delay);
				channel.timer.unref();
			}
		}
	}
}
