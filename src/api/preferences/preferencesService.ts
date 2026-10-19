import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { AuthService } from "../auth/authService.js";

export type Preferences = Record<string, unknown>;

const LANGUAGE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/** Allowed preference keys. Add an entry here to let the frontend persist a new setting. */
const PREFERENCE_VALIDATORS: Record<string, (value: unknown) => boolean> = {
	language: (value) => typeof value === "string" && value.length <= 35 && LANGUAGE_PATTERN.test(value),
};

@Injectable()
export class PreferencesService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	async get(authorization?: string): Promise<Preferences> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const row = await this.dataSource.getRepository(UserPreference).findOneBy({ userId: user.id });
		return row?.data ?? {};
	}

	async update(patch: Preferences, authorization?: string): Promise<Preferences> {
		const user = await this.authService.getAuthenticatedUser(authorization);

		for (const [key, value] of Object.entries(patch)) {
			const validate = PREFERENCE_VALIDATORS[key];
			if (!validate) {
				throw new BadRequest(`Unknown preference "${key}".`);
			}
			if (value !== null && !validate(value)) {
				throw new BadRequest(`Invalid value for preference "${key}".`);
			}
		}

		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(UserPreference);
			const row = await repository.findOne({ where: { userId: user.id }, lock: { mode: "pessimistic_write" } });
			const data: Preferences = { ...row?.data };
			for (const [key, value] of Object.entries(patch)) {
				if (value === null) {
					delete data[key];
				} else {
					data[key] = value;
				}
			}
			await repository.upsert({ userId: user.id, data }, ["userId"]);
			return data;
		});
	}
}
