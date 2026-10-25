import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { NetworkShare } from "../../entities/networkShare.entity.js";
import type { MediaRoot } from "../mediaLibraries/mediaRootsService.js";
import { localPathFor, mountShare, MountError, unmountShare, type MountTarget } from "./shareMounter.js";
import { decryptSecret, encryptSecret } from "./shareSecrets.js";

export type ShareStatus = "connecting" | "connected" | "error";

export interface PublicNetworkShare {
	id: string;
	name: string;
	protocol: "smb";
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
	username?: string | null;
	domain?: string | null;
	/** undefined keeps the saved password, "" or null clears it. */
	password?: string | null;
	readOnly?: boolean;
}

const UNIQUE_VIOLATION = "23505";
const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;
// Characters that are illegal in SMB share names or could alter the mount options / command line.
const SHARE_PATTERN = /^[^\\/:*?"<>|,\0-\x1f-][^\\/:*?"<>|,\0-\x1f]*$/;
const ACCOUNT_PATTERN = /^[^\\/:,;"\0-\x1f][^\\/:,;"\0-\x1f]*$/;

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
		const values = this.validate(input);
		const share = this.dataSource.getRepository(NetworkShare).create({
			id: randomUUID(),
			...values,
			passwordEncrypted: input.password ? encryptSecret(input.password) : null,
		});
		await this.connect(share, true, true);
		await this.save(share);
		this.shares.set(share.id, share);
		return this.toPublic(share);
	}

	async update(id: string, input: Partial<ShareInput>): Promise<PublicNetworkShare> {
		const share = this.require(id);
		const previous = { ...share };
		const values = this.validate({
			name: input.name ?? share.name,
			host: input.host ?? share.host,
			share: input.share ?? share.share,
			username: input.username === undefined ? share.username : input.username,
			domain: input.domain === undefined ? share.domain : input.domain,
			readOnly: input.readOnly ?? share.readOnly,
		});
		const next = Object.assign(this.dataSource.getRepository(NetworkShare).create(), share, values);
		if (input.password !== undefined) {
			next.passwordEncrypted = input.password ? encryptSecret(input.password) : null;
		}
		if (!next.username) {
			next.passwordEncrypted = null;
		}

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

	private validate(input: ShareInput) {
		const name = input.name?.trim();
		const host = input.host?.trim();
		const share = input.share?.trim().replace(/^[\\/]+|[\\/]+$/g, "");
		const username = input.username?.trim() || null;
		const domain = input.domain?.trim() || null;
		if (!name) {
			throw new BadRequest("Give the share a name.");
		}
		if (!host || !HOST_PATTERN.test(host)) {
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
		return { name, protocol: "smb" as const, host, share, username, domain: username ? domain : null, readOnly: input.readOnly ?? true };
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
		return { id: share.id, host: share.host, share: share.share, username: share.username, domain: share.domain, password, readOnly: share.readOnly };
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
