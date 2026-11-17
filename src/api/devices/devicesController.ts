import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { DevicesService } from "./devicesService.js";
import { LiveService } from "../../live/liveService.js";

/** Admin view of the devices (login sessions) connected to this server. */
@Controller("/admin/devices")
@Security("BearerAuth")
export class DevicesController {

	constructor(
		private readonly authService: AuthService,
		private readonly devices: DevicesService,
		private readonly live: LiveService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		const { session } = await this.authService.requireAdminSession(authorization);
		return this.devices.list(session.id);
	}

	@Delete("/:id")
	@Returns(204)
	async signOut(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const { session } = await this.authService.requireAdminSession(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Device not found.");
		}
		await this.devices.signOut(id.toLowerCase(), session.id);
		this.live.invalidate("devices");
	}
}
