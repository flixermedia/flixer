import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound, RequestEntityTooLarge } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { AuthService, type PublicUser } from "./authService.js";
import { deleteAvatarFile, detectAvatarType, MAX_AVATAR_BYTES, mimeForAvatarFile, readAvatarFile, saveAvatarFile } from "./avatarStorage.js";

@Injectable()
export class AvatarService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	async uploadAvatar(authorization: string | undefined, file: { buffer?: Buffer; size?: number } | undefined): Promise<PublicUser> {
		const current = await this.authService.getAuthenticatedUser(authorization);
		if (!file?.buffer?.length) {
			throw new BadRequest("Choose an image to upload.");
		}
		if (file.buffer.length > MAX_AVATAR_BYTES) {
			throw new RequestEntityTooLarge("Profile pictures must be 5 MB or smaller.");
		}

		const type = detectAvatarType(file.buffer);
		if (!type) {
			throw new BadRequest("Profile pictures must be a PNG, JPEG, WebP or GIF image.");
		}

		const repository = this.dataSource.getRepository(User);
		const user = await repository.findOneByOrFail({ id: current.id });
		const previous = user.avatarFile;
		user.avatarFile = await saveAvatarFile(user.id, file.buffer, type);

		let saved: User;
		try {
			saved = await repository.save(user);
		} catch (error) {
			await deleteAvatarFile(user.avatarFile);
			throw error;
		}

		await deleteAvatarFile(previous);
		return this.authService.toPublicUserFor(saved);
	}

	async removeAvatar(authorization: string | undefined): Promise<PublicUser> {
		const current = await this.authService.getAuthenticatedUser(authorization);
		const repository = this.dataSource.getRepository(User);
		const user = await repository.findOneByOrFail({ id: current.id });
		const previous = user.avatarFile;
		user.avatarFile = null;
		const saved = await repository.save(user);
		await deleteAvatarFile(previous);
		return this.authService.toPublicUserFor(saved);
	}

	async getAvatar(filename: string): Promise<{ data: Buffer; mime: string }> {
		const mime = mimeForAvatarFile(filename);
		const data = mime ? await readAvatarFile(filename) : null;
		if (!mime || !data) {
			throw new NotFound("Profile picture not found.");
		}
		return { data, mime };
	}
}
