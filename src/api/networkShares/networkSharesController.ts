import { Controller } from "@tsed/di";
import { Conflict, NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.ts";
import { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.ts";
import { CreateNetworkShareRequest, UpdateNetworkShareRequest } from "./networkShareRequests.ts";
import { NetworkSharesService } from "./networkSharesService.ts";
import { smbMountSupported } from "./smbSupport.ts";
import { LiveService } from "../../live/liveService.ts";

/** Network share (SMB) management for the admin dashboard. */
@Controller("/admin/network-shares")
@Security("BearerAuth")
export class NetworkSharesController {

	constructor(
		private readonly authService: AuthService,
		private readonly shares: NetworkSharesService,
		private readonly libraries: MediaLibrariesService,
		private readonly live: LiveService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.shares.list();
	}

	/** Whether this host can mount SMB shares from inside the container; false on Docker Desktop. */
	@Get("/support")
	async support(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return { supported: smbMountSupported() };
	}

	@Post("/")
	async create(@BodyParams() request: CreateNetworkShareRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const share = await this.shares.create(request);
		this.live.invalidate("shares");
		return share;
	}

	@Patch("/:id")
	async update(@PathParams("id") id: string, @BodyParams() request: UpdateNetworkShareRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const share = await this.shares.update(this.parseId(id), request);
		this.live.invalidate("shares");
		return share;
	}

	@Post("/:id/reconnect")
	async reconnect(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const share = await this.shares.reconnect(this.parseId(id));
		this.live.invalidate("shares");
		return share;
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const shareId = this.parseId(id);
		const rootId = this.shares.rootIdOf(shareId);
		const user = (await this.libraries.entities()).find((library) => library.folders.some((folder) => folder.rootId === rootId));
		if (user) {
			throw new Conflict(`The media library "${user.name}" uses this share. Remove its folders first.`);
		}
		await this.shares.remove(shareId);
		this.live.invalidate("shares", "overview");
	}

	private parseId(id: string): string {
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Network share not found.");
		}
		return id.toLowerCase();
	}
}
