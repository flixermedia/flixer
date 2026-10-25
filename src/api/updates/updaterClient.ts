import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { createHmac } from "node:crypto";
import { DataSource } from "typeorm";
import { appConfig } from "../../config/store/appConfig.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";

const DEFAULT_UPDATER_URL = "http://updater:8093";
const DEFAULT_TIMEOUT_MS = 10_000;

/** Must match the updater: hex(HMAC-SHA256(secret, "flixer-updater-token")). */
export function deriveUpdaterToken(secret: string | undefined | null): string | undefined {
	return secret ? createHmac("sha256", secret).update("flixer-updater-token").digest("hex") : undefined;
}

export interface UpdaterCallOptions extends Omit<RequestInit, "signal"> {
	timeoutMs?: number;
	/** Needed by fetch when the body is a stream. */
	duplex?: "half";
}

/** Talks to the flixer-updater sidecar, which holds the Docker socket; Flixer never touches Docker itself. */
@Injectable()
export class UpdaterClient {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/** An explicit UPDATER_TOKEN wins; otherwise it is derived from the stream token secret the updater also reads. */
	token(): string | undefined {
		return process.env.UPDATER_TOKEN?.trim() || deriveUpdaterToken(appConfig().get("streamTokenSecret"));
	}

	async url(): Promise<string> {
		const configured = (await this.dataSource.getRepository(Setting).findOneBy({ key: "updates_updater_url" }))?.value;
		const url = (typeof configured === "string" && configured.trim() !== "" ? configured.trim() : process.env.UPDATER_URL?.trim()) || DEFAULT_UPDATER_URL;
		return url.replace(/\/+$/, "");
	}

	async call(path: string, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...init }: UpdaterCallOptions = {}): Promise<Response> {
		const url = `${await this.url()}${path}`;
		try {
			return await fetch(url, {
				...init,
				headers: { authorization: `Bearer ${this.token() ?? ""}`, "content-type": "application/json", ...(headers as Record<string, string> | undefined) },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new BadRequest(`Could not reach the updater: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
