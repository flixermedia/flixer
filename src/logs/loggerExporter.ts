import { randomUUID } from "node:crypto";
import type { UnifiedLogRecord } from "./unifiedLog.js";

const QUEUE_LIMIT = 1000;
const BATCH_LIMIT = 100;
const INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;
const CIRCUIT_FAILURES = 3;
const CIRCUIT_PAUSE_MS = 30_000;
const instanceId = randomUUID();

interface ExportEvent {
	schema_version: 1;
	event_id: string;
	time: string;
	level: string;
	instance_id: string;
	app: string;
	source: string;
	message: string;
	event?: string;
	task_id?: string;
	request_id?: string;
	trace_id?: string;
	duration_ms?: number;
	fields?: { status_code: number };
}

interface Configuration {
	endpoint: string;
	token: string;
	expiresAt: string;
}

function redact(value: string): string {
	return value
		.replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/-]+=*/gi, "[REDACTED]")
		.replace(/\b(?:set-cookie|cookie)["']?\s*[:=]\s*[^\r\n]*/gi, "[REDACTED]")
		.replace(/\b[a-z0-9_-]*(?:password|passwd|secret|token|authorization|api[_-]?key|credential|private[_-]?key)[a-z0-9_-]*["']?\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "[REDACTED]")
		.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[REDACTED]")
		.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[REDACTED]")
		.replace(/(^|[\s("'=])(?:\/[A-Za-z0-9._-]+){2,}[^\s"']*/g, "$1[REDACTED]");
}

function identifier(value: unknown): string | undefined {
	return typeof value === "string" && /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : undefined;
}

function retryAfter(value: string | null): number {
	if (!value) return 0;
	const seconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
	return Number.isFinite(seconds) ? Math.min(30_000, Math.max(0, seconds)) : 0;
}

/** Bounded asynchronous delivery; the normal Ts.ED appenders remain unchanged. */
export class LoggerExporter {
	private configuration?: Configuration;
	private queue: ExportEvent[] = [];
	private timer?: ReturnType<typeof setTimeout>;
	private controller?: AbortController;
	private generation = 0;
	private sending = false;
	private closed = false;
	private draining = false;
	private inFlight?: Promise<void>;
	private shutdownPromise?: Promise<void>;
	private dropped = 0;
	private expiredReported = false;
	private lastDeliveredAt?: string;
	private lastFailureAt?: string;
	private consecutiveFailures = 0;
	private circuitOpenUntil = 0;

	status() {
		return {
			enabled: Boolean(this.configuration),
			queued: this.queue.length,
			sending: this.sending,
			dropped: this.dropped,
			lastDeliveredAt: this.lastDeliveredAt ?? null,
			lastFailureAt: this.lastFailureAt ?? null,
			circuitOpenUntil: this.circuitOpenUntil > Date.now() ? new Date(this.circuitOpenUntil).toISOString() : null,
		};
	}

	configure(configuration?: Configuration): void {
		if (this.draining) throw new Error("Logger exporter is shutting down.");
		this.closed = false;
		this.shutdownPromise = undefined;
		this.generation++;
		this.controller?.abort();
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		if (this.queue.length) {
			this.dropped += this.queue.length;
			this.report("queued records discarded after logger configuration changed");
		}
		this.queue = [];
		this.configuration = configuration;
		this.expiredReported = false;
		this.consecutiveFailures = 0;
		this.circuitOpenUntil = 0;
	}

	renewCredential(configuration: Configuration): void {
		if (this.closed || this.draining) throw new Error("Logger exporter is shut down.");
		if (!this.configuration || this.configuration.endpoint !== configuration.endpoint) {
			this.configure(configuration);
			return;
		}
		this.configuration = configuration;
		this.expiredReported = false;
		this.consecutiveFailures = 0;
		this.circuitOpenUntil = 0;
	}

	enqueue(record: UnifiedLogRecord): void {
		if (!this.configuration || this.closed || this.draining) return;
		if (Date.parse(this.configuration.expiresAt) <= Date.now()) {
			this.dropped++;
			if (!this.expiredReported) {
				this.expiredReported = true;
				this.report("ingestion credential expired");
			}
			return;
		}
		if (this.queue.length >= QUEUE_LIMIT) {
			this.dropped++;
			if (this.dropped === 1 || this.dropped % 1000 === 0) this.report("export queue is full");
			return;
		}
		const event: ExportEvent = {
			schema_version: 1,
			event_id: randomUUID(),
			time: record.time,
			level: record.level,
			instance_id: instanceId,
			app: "flixer",
			source: redact(record.source).slice(0, 256),
			message: redact(record.message).slice(0, 4000) || "(empty log message)",
			event: identifier(record.event),
			task_id: identifier(record.task_id ?? record.taskId),
			request_id: identifier(record.request_id ?? record.requestId),
			trace_id: identifier(record.trace_id ?? record.traceId),
			duration_ms: typeof record.duration_ms === "number" && Number.isFinite(record.duration_ms) &&
				record.duration_ms >= 0 && record.duration_ms <= 86_400_000 ? record.duration_ms : undefined,
			fields: typeof record.status_code === "number" && Number.isInteger(record.status_code) &&
				record.status_code >= 100 && record.status_code <= 599 ? { status_code: record.status_code } : undefined,
		};
		this.queue.push(event);
		this.schedule(this.queue.length >= BATCH_LIMIT ? 0 : INTERVAL_MS);
	}

	private schedule(delay: number): void {
		if (this.sending || this.timer || !this.configuration || this.draining || this.closed) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.startFlush();
		}, delay);
		this.timer.unref();
	}

	private startFlush(): Promise<void> {
		if (this.inFlight) return this.inFlight;
		const task = this.flush();
		this.inFlight = task;
		void task.then(() => {
			if (this.inFlight === task) this.inFlight = undefined;
		}, () => {
			if (this.inFlight === task) this.inFlight = undefined;
			this.report("export worker failed");
		});
		return task;
	}

	/** Flushes buffered events for at most the given time, then aborts and drops the remainder. */
	shutdown(timeoutMs: number): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError("Invalid logger shutdown timeout.");
		this.draining = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.shutdownPromise = this.drain(timeoutMs);
		return this.shutdownPromise;
	}

	private async drain(timeoutMs: number): Promise<void> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let expired = false;
		const deadline = new Promise<void>((resolve) => {
			timeout = setTimeout(() => { expired = true; resolve(); }, timeoutMs);
		});
		try {
			while (!expired && (this.inFlight || (this.configuration && this.queue.length))) {
				await Promise.race([this.inFlight ?? this.startFlush(), deadline]);
			}
		} finally {
			if (timeout) clearTimeout(timeout);
			this.closed = true;
			this.generation++;
			this.controller?.abort();
			if (this.queue.length) {
				this.dropped += this.queue.length;
				this.queue = [];
				this.report("queued records discarded during shutdown");
			}
			this.configuration = undefined;
			this.draining = false;
		}
	}

	private async flush(): Promise<void> {
		const configuration = this.configuration;
		if (!configuration || this.sending || !this.queue.length) return;
		const generation = this.generation;
		const batch = this.queue.splice(0, BATCH_LIMIT);
		this.sending = true;
		try {
			if (this.circuitOpenUntil > Date.now()) {
				this.dropped += batch.length;
				if (this.dropped % 1000 < batch.length) this.report("delivery circuit is open");
				return;
			}
			const { failed, transient } = await this.deliver(batch, generation);
			if (failed) {
				this.dropped += failed;
				this.report("a log batch could not be delivered");
			}
			if (failed < batch.length) this.lastDeliveredAt = new Date().toISOString();
			if (generation === this.generation) {
				if (transient) {
					this.consecutiveFailures++;
					if (this.consecutiveFailures >= CIRCUIT_FAILURES) this.circuitOpenUntil = Date.now() + CIRCUIT_PAUSE_MS;
				} else {
					this.consecutiveFailures = 0;
					this.circuitOpenUntil = 0;
				}
			}
		} finally {
			this.sending = false;
			this.controller = undefined;
			if (this.queue.length) this.schedule(0);
		}
	}

	private async deliver(batch: ExportEvent[], generation: number): Promise<{ failed: number; transient: boolean }> {
		const body = JSON.stringify({ events: batch });
		for (let attempt = 0; attempt < MAX_ATTEMPTS && generation === this.generation; attempt++) {
			const current = this.configuration;
			if (!current) break;
			this.controller = new AbortController();
			let serverDelay = 0;
			try {
				const response = await fetch(`${current.endpoint}/api/logs/batch`, {
					method: "POST",
					headers: { authorization: `Bearer ${current.token}`, "content-type": "application/json", "x-flixer-log-schema": "1" },
					body,
					redirect: "error",
					signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5_000)]),
				});
				if (response.ok) {
					if (await this.acknowledged(response, batch.length)) return { failed: 0, transient: false };
				} else if (response.status === 400 && batch.length > 1) {
					await response.body?.cancel();
					const middle = Math.floor(batch.length / 2);
					const left = await this.deliver(batch.slice(0, middle), generation);
					const right = await this.deliver(batch.slice(middle), generation);
					return { failed: left.failed + right.failed, transient: left.transient || right.transient };
				} else if (response.status === 401 && generation === this.generation &&
					this.configuration?.token !== current.token && attempt + 1 < MAX_ATTEMPTS) {
					await response.body?.cancel();
					continue;
				} else if (response.status !== 429 && response.status < 500) {
					await response.body?.cancel();
					return { failed: batch.length, transient: false };
				} else {
					serverDelay = retryAfter(response.headers.get("retry-after"));
					await response.body?.cancel();
				}
			} catch {
				// Retrying is bounded and does not affect the caller.
			}
			if (attempt + 1 < MAX_ATTEMPTS && generation === this.generation) {
				const delay = Math.max(serverDelay, (250 * 2 ** attempt) + Math.floor(Math.random() * 250));
				await new Promise<void>((resolve) => {
					const signal = this.controller!.signal;
					const finish = () => {
						clearTimeout(timer);
						signal.removeEventListener("abort", finish);
						resolve();
					};
					const timer = setTimeout(finish, delay);
					signal.addEventListener("abort", finish, { once: true });
					if (signal.aborted) finish();
				});
			}
		}
		return { failed: batch.length, transient: generation === this.generation };
	}

	private async acknowledged(response: Response, expected: number): Promise<boolean> {
		if (!response.body) return false;
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 4096) {
					await reader.cancel();
					return false;
				}
				chunks.push(value);
			}
			const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { accepted?: unknown };
			return payload.accepted === expected;
		} finally {
			reader.releaseLock();
		}
	}

	private report(message: string): void {
		this.lastFailureAt = new Date().toISOString();
		process.stderr.write(`Flixer logger: ${message}; dropped=${this.dropped}\n`);
	}
}

export const loggerExporter = new LoggerExporter();
