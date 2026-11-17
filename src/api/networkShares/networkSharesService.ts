import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.ts";
import { NetworkShare, type NetworkShareProtocol } from "../../entities/networkShare.entity.ts";
import type { MediaRoot } from "../mediaLibraries/mediaRootsService.ts";
import { localPathFor, mountShare, MountError, unmountShare, type MountTarget } from "./shareMounter.ts";
import { decryptSecret, encryptSecret } from "./shareSecrets.ts";

export type ShareStatus = "connecting" | "connected" | "error";

export interface PublicNetworkShare {
	id: string;
	name: string;
	protocol: NetworkShareProtocol;
	region: string | null;
	host: string;
	share: string;
	username: string | null;
	domain: string | null;
	hasPassword: boolean;
	readOnly: boolean;
	rootId: string;
	/** Where the share's contents appear on the server, shown to admins only. */
	location: string;
	status: ShareStatus;
	error: string | null;
}

export interface ShareInput {
	name: string;
	host: string;
	share: string;
	protocol?: NetworkShareProtocol;
	username?: string | null;
	domain?: string | null;
	region?: string | null;
	/** undefined keeps the saved password, "" or null clears it. */
	password?: string | null;
	readOnly?: boolean;
}

const UNIQUE_VIOLATION = "23505";
const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;
// Characters that are illegal in SMB share names or could alter the mount options / command line.
const SHARE_PATTERN = /^[^\\/:*?"<>|,\0-\x1f-][^\\/:*?"<>|,\0-\x1f]*$/;
const ACCOUNT_PATTERN = /^[^\\/:,;"\0-\x1f][^\\/:,;"\0-\x1f]*$/;

function endpoint(value: string, protocol: "webdav" | "s3"): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new BadRequest(`Enter a valid ${protocol === "webdav" ? "WebDAV" : "S3"} endpoint URL.`);
	}
	if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new BadRequest("Use an HTTP(S) endpoint without embedded credentials, query parameters, or a fragment.");
	}
	return parsed.href.replace(/\/$/, "");
}

function safeRemotePath(value: string): boolean {
	return !/[\\\0-\x1f]/.test(value) && !value.split("/").some((segment) => segment === "." || segment === "..");
}

/** Validates and normalizes persisted share settings without changing legacy SMB defaults. */
export function normalizeShareInput(input: ShareInput) {
	const protocol = input.protocol ?? "smb";
	const name = input.name?.trim();
	let host = input.host?.trim();
	let share = input.share?.trim();
	const username = input.username?.trim() || null;
	const domain = input.domain?.trim() || null;
	let region = input.region?.trim() || null;
	if (!name) {
		throw new BadRequest("Give the share a name.");
	}
	if (!host || host.length > 255) {
		throw new BadRequest("Enter a valid server or endpoint.");
	}
	if (protocol === "smb") {
		share = share?.replace(/^[\\/]+|[\\/]+$/g, "");
		if (!HOST_PATTERN.test(host)) {
			throw new BadRequest("Enter the server's host name or IP address, for example nas.local or 192.168.1.20.");
		}
		if (!share || !SHARE_PATTERN.test(share)) {
			throw new BadRequest("Enter the share name only, without slashes, for example Media.");
		}
		if (username && !ACCOUNT_PATTERN.test(username)) {
			throw new BadRequest("The username contains characters that are not allowed.");
		}
		if (domain && (!ACCOUNT_PATTERN.test(domain) || !username)) {
			throw new BadRequest(username ? "The domain contains characters that are not allowed." : "A domain needs a username.");
		}
		return { name, protocol, host, share, username, domain: username ? domain : null, region: null, readOnly: input.readOnly ?? true };
	}

	if (protocol === "nfs") {
		if (!HOST_PATTERN.test(host) || !share?.startsWith("/") || !safeRemotePath(share)) {
			throw new BadRequest("Enter an NFS server and an absolute export path without dot segments.");
		}
		return { name, protocol, host, share, username: null, domain: null, region: null, readOnly: true };
	}

	host = endpoint(host, protocol);
	if (!safeRemotePath(share ?? "")) {
		throw new BadRequest("The remote path cannot contain dot segments or control characters.");
	}
	if (protocol === "webdav") {
		share = share?.replace(/^\/+|\/+$/g, "") || "/";
		if (username && !ACCOUNT_PATTERN.test(username)) {
			throw new BadRequest("The username contains characters that are not allowed.");
		}
		return { name, protocol, host, share, username, domain: null, region: null, readOnly: true };
	}

	share = share?.replace(/^\/+|\/+$/g, "");
	if (!share || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}(\/[^\\\0-\x1f]+)*$/.test(share) || !username || !ACCOUNT_PATTERN.test(username)) {
		throw new BadRequest("Enter an S3 bucket or bucket/prefix and an access key.");
	}
	if (share.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new BadRequest("The S3 path cannot contain dot segments.");
	}
	region = region || "us-east-1";
	if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(region)) {
		throw new BadRequest("Enter a valid S3 region.");
	}
	return { name, protocol, host, share, username, domain: null, region, readOnly: true };
}

export function shareRootId(id: string): string {
	return `share-${id.replace(/-/g, "").slice(0, 12)}`;
}

/** Network shares (SMB) connected to the server and offered as media roots. */
@Injectable()
export class NetworkSharesService {

	private shares = new Map<string, NetworkShare>();
	private state = new Map<string, { status: ShareStatus; error: string | null }>();

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async $onInit(): Promise<void> {
		await this.reload();
		// Connecting can be slow when a share is down, so it must not hold up startup.
		for (const share of this.shares.values()) {
			void this.connect(share).catch(() => undefined);
		}
	}

	/** The connected shares as media roots. Synchronous so MediaRootsService.list() can stay so. */
	roots(): MediaRoot[] {
		return [...this.shares.values()].map((share) => ({ id: shareRootId(share.id), name: share.name, path: localPathFor(share) }));
	}

	list(): PublicNetworkShare[] {
		return [...this.shares.values()].sort((a, b) => a.name.localeCompare(b.name)).map((share) => this.toPublic(share));
	}

	async create(input: ShareInput): Promise<PublicNetworkShare> {
		const values = normalizeShareInput(input);
		const share = this.dataSource.getRepository(NetworkShare).create({
			id: randomUUID(),
			...values,
			passwordEncrypted: input.password && values.protocol !== "nfs" ? encryptSecret(input.password) : null,
		});
		this.validateCredentials(share, input.password);
		await this.connect(share, true, true);
		await this.save(share);
		this.shares.set(share.id, share);
		return this.toPublic(share);
	}

	async update(id: string, input: Partial<ShareInput>): Promise<PublicNetworkShare> {
		const share = this.require(id);
		const previous = { ...share };
		const values = normalizeShareInput({
			name: input.name ?? share.name,
			host: input.host ?? share.host,
			share: input.share ?? share.share,
			protocol: input.protocol ?? share.protocol,
			username: input.username === undefined ? share.username : input.username,
			domain: input.domain === undefined ? share.domain : input.domain,
			region: input.region === undefined ? share.region : input.region,
			readOnly: input.readOnly ?? share.readOnly,
		});
		const next = Object.assign(this.dataSource.getRepository(NetworkShare).create(), share, values);
		if (values.protocol === "nfs") {
			next.passwordEncrypted = null;
		} else if (input.password !== undefined) {
			next.passwordEncrypted = input.password ? encryptSecret(input.password) : null;
		} else if (values.protocol !== share.protocol) {
			next.passwordEncrypted = null;
		}
		if (!next.username) {
			next.passwordEncrypted = null;
		}
		this.validateCredentials(next, input.password);

		await unmountShare(previous).catch(() => undefined);
		try {
			await this.connect(next, true, true);
		} catch (error: unknown) {
			await this.connect(share, true).catch(() => undefined);
			throw error;
		}
		await this.save(next);
		this.shares.set(id, next);
		return this.toPublic(next);
	}

	/** Reconnects a share, e.g. after the file server came back. */
	async reconnect(id: string): Promise<PublicNetworkShare> {
		const share = this.require(id);
		await this.connect(share, true).catch(() => undefined);
		return this.toPublic(share);
	}

	async remove(id: string): Promise<boolean> {
		const share = this.shares.get(id);
		if (!share) {
			return false;
		}
		await unmountShare(share).catch(() => undefined);
		await this.dataSource.getRepository(NetworkShare).delete({ id });
		this.shares.delete(id);
		this.state.delete(id);
		return true;
	}

	/** The root id a share is offered under, for checking whether libraries use it. */
	rootIdOf(id: string): string {
		return shareRootId(this.require(id).id);
	}

	private async reload(): Promise<void> {
		const rows = await this.dataSource.getRepository(NetworkShare).find();
		this.shares = new Map(rows.map((row) => [row.id, row]));
	}

	private require(id: string): NetworkShare {
		const share = this.shares.get(id);
		if (!share) {
			throw new NotFound("Network share not found.");
		}
		return share;
	}

	private target(share: NetworkShare): MountTarget {
		let password: string | null = null;
		if (share.passwordEncrypted) {
			try {
				password = decryptSecret(share.passwordEncrypted);
			} catch {
				throw new MountError("The saved password cannot be read. APP_SECRET changed; re-enter the password.");
			}
		}
		return { id: share.id, protocol: share.protocol, host: share.host, share: share.share, username: share.username, domain: share.domain, region: share.region, password, readOnly: share.readOnly };
	}

	private validateCredentials(share: NetworkShare, password?: string | null): void {
		if (share.protocol === "s3" && (!share.username || (!password && !share.passwordEncrypted))) {
			throw new BadRequest("S3 storage requires an access key and secret key.");
		}
		if (share.protocol === "webdav" && password && !share.username) {
			throw new BadRequest("A WebDAV password requires a username.");
		}
	}

	/** Connects a share and records the outcome. With rethrow the failure also reaches the caller. */
	private async connect(share: NetworkShare, force = false, rethrow = false): Promise<void> {
		this.state.set(share.id, { status: "connecting", error: null });
		try {
			await mountShare(this.target(share), force);
			this.state.set(share.id, { status: "connected", error: null });
		} catch (error: unknown) {
			const message = error instanceof MountError ? error.message : "Could not connect to the share.";
			this.state.set(share.id, { status: "error", error: message });
			if (rethrow) {
				this.state.delete(share.id);
				throw new BadRequest(message);
			}
			throw error;
		}
	}

	private async save(share: NetworkShare): Promise<void> {
		try {
			await this.dataSource.getRepository(NetworkShare).save(share);
		} catch (error: unknown) {
			if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
				await unmountShare(share).catch(() => undefined);
				throw new Conflict("A network share with this name already exists.");
			}
			throw error;
		}
	}

	private toPublic(share: NetworkShare): PublicNetworkShare {
		const state = this.state.get(share.id) ?? { status: "connecting" as const, error: null };
		return {
			id: share.id,
			name: share.name,
			protocol: share.protocol,
			region: share.region,
			host: share.host,
			share: share.share,
			username: share.username,
			domain: share.domain,
			hasPassword: Boolean(share.passwordEncrypted),
			readOnly: share.readOnly,
			rootId: shareRootId(share.id),
			location: localPathFor(share),
			status: state.status,
			error: state.error,
		};
	}
}
