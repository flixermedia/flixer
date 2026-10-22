export type LiveLogLevel = "debug" | "info" | "warn" | "error";

export interface LiveLogEntry {
	id: number;
	time: string;
	level: LiveLogLevel;
	app: string;
	source: string;
	message: string;
	fields?: Record<string, unknown>;
}

export type LiveLogListener = (entry: LiveLogEntry) => void;

const BUFFER_SIZE = 500;

/**
 * In-memory fan-out for log events. It keeps the most recent entries so a client that
 * connects can see what just happened, and pushes new entries to subscribers. It must
 * never log itself: it is fed by the logger.
 */
export class LiveLogHub {

	private readonly buffer: LiveLogEntry[] = [];
	private readonly listeners = new Set<LiveLogListener>();
	private nextId = 1;

	publish(entry: Omit<LiveLogEntry, "id">): void {
		const stored: LiveLogEntry = { ...entry, id: this.nextId++ };
		this.buffer.push(stored);
		if (this.buffer.length > BUFFER_SIZE) {
			this.buffer.shift();
		}
		for (const listener of this.listeners) {
			try {
				listener(stored);
			} catch {
				// A failing subscriber must not break logging for everyone else.
			}
		}
	}

	snapshot(): LiveLogEntry[] {
		return [...this.buffer];
	}

	subscribe(listener: LiveLogListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

export const liveLogHub = new LiveLogHub();
