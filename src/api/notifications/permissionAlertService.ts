import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource, IsNull } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { NotificationService } from "./notificationService.js";

const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_TRACKED_ALERTS = 500;
const PERMISSION_CODES = new Set(["EACCES", "EPERM"]);
const PERMISSION_ERRNOS = new Set([-13, -1]);
const PERMISSION_MESSAGE_PATTERN = /\b(EACCES|EPERM)\b|permission denied/i;
const PATH_IN_MESSAGE_PATTERN = /(?:open|stat|lstat|readdir|mkdir|unlink|rename|access)\s+([^\s:][^:]*?):\s*permission denied/i;

export interface PermissionAlertInput {
	source: string;
	operation?: string;
	path?: string;
	message?: string;
	url?: string;
}

export interface PermissionErrorContext {
	source: string;
	operation?: string;
	path?: string;
	url?: string;
}

function errorChain(error: unknown): unknown[] {
	const chain: unknown[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current && typeof current === "object" && !seen.has(current); depth += 1) {
		seen.add(current);
		chain.push(current);
		const record = current as { origin?: unknown; cause?: unknown };
		current = record.origin ?? record.cause;
	}
	return chain;
}

/** Returns true when an error or its cause/origin represents a filesystem permission failure. */
export function isPermissionError(error: unknown): boolean {
	if (!error) return false;
	if (typeof error === "string") return PERMISSION_MESSAGE_PATTERN.test(error);
	for (const entry of errorChain(error)) {
		const record = entry as { code?: unknown; errno?: unknown; message?: unknown };
		if (typeof record.code === "string" && PERMISSION_CODES.has(record.code)) return true;
		if (typeof record.errno === "number" && PERMISSION_ERRNOS.has(record.errno)) return true;
		if (typeof record.message === "string" && PERMISSION_MESSAGE_PATTERN.test(record.message)) return true;
	}
	return false;
}

/** Extracts the affected filesystem path from an error when available. */
export function extractPermissionPath(error: unknown): string | undefined {
	for (const entry of errorChain(error)) {
		const record = entry as { path?: unknown; message?: unknown };
		if (typeof record.path === "string" && record.path.trim()) return record.path.trim();
		if (typeof record.message === "string") {
			const match = PATH_IN_MESSAGE_PATTERN.exec(record.message);
			if (match?.[1]?.trim()) return match[1].trim();
		}
	}
	return undefined;
}

/** Deduplicates filesystem permission errors and notifies active Flixer admins. */
@Injectable()
export class PermissionAlertService {

	private readonly recentAlerts = new Map<string, number>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	/** Reports a permission error to all active admins unless the same alert was sent recently. */
	async report(input: PermissionAlertInput, now = Date.now()): Promise<boolean> {
		const source = input.source.trim() || "flixer";
		const operation = input.operation?.trim() || undefined;
		const path = input.path?.trim() || undefined;
		const message = input.message?.trim() || undefined;
		const key = `${source}:${operation ?? ""}:${path ?? message ?? ""}`;
		if (this.isCoolingDown(key, now)) {
			return false;
		}
		this.recordAlert(key, now);

		const title = `Permission denied in ${source}`.slice(0, 120);
		const parts = [operation ? `Operation: ${operation}` : undefined, path ? `Path: ${path}` : undefined, message].filter(Boolean);
		const body = (parts.join(" — ") || "A service lacked permission to access a required file or directory.").slice(0, 500);
		const url = input.url?.trim() || "/admin?tab=logs";

		logger().error(`${title}: ${body}`);

		try {
			const admins = await this.dataSource.getRepository(User).find({ where: { role: "admin", disabledAt: IsNull() }, select: { id: true } });
			if (admins.length === 0) return true;
			await this.notifications.send(
				{ kind: "admin", title, body, url },
				admins.map((admin) => admin.id),
			);
		} catch (error) {
			logger().warn("Could not notify admins about a permission error.", error);
		}
		return true;
	}

	/** Reports an error to admins when it represents a filesystem permission failure. */
	async reportError(error: unknown, context: PermissionErrorContext, now = Date.now()): Promise<boolean> {
		if (!isPermissionError(error)) return false;
		const message = error instanceof Error ? error.message : String(error);
		return this.report(
			{
				source: context.source,
				operation: context.operation,
				path: context.path ?? extractPermissionPath(error),
				message,
				url: context.url,
			},
			now,
		);
	}

	private isCoolingDown(key: string, now: number): boolean {
		const last = this.recentAlerts.get(key);
		return last !== undefined && now - last < ALERT_COOLDOWN_MS;
	}

	private recordAlert(key: string, now: number): void {
		if (this.recentAlerts.size >= MAX_TRACKED_ALERTS) {
			for (const [entryKey, ts] of this.recentAlerts) {
				if (now - ts >= ALERT_COOLDOWN_MS) this.recentAlerts.delete(entryKey);
			}
			while (this.recentAlerts.size >= MAX_TRACKED_ALERTS) {
				const oldest = this.recentAlerts.keys().next().value;
				if (oldest === undefined) break;
				this.recentAlerts.delete(oldest);
			}
		}
		this.recentAlerts.set(key, now);
	}
}
