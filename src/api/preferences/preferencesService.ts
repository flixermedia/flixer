import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { AuthService } from "../auth/authService.js";

export interface DashboardGridItem {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Preferences {
	language?: string;
	adminDashboardGrid?: DashboardGridItem[];
	browseColumns?: number;
	autoSkipIntroCredits: boolean;
}

const LANGUAGE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

const WIDGET_PATTERN = /^[a-z][a-z-]{0,31}$/;

const isIntIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/**
 * The admin dashboard: where each panel sits on a 5-column grid. `y` and `h` count half-rows; a panel is 1 to 6 half-rows tall,
 * must stay inside the columns, and each panel appears once.
 */
export const isDashboardGrid = (value: unknown): value is DashboardGridItem[] => {
	if (!Array.isArray(value) || value.length > 40) {
		return false;
	}
	const ids = new Set<string>();
	for (const item of value) {
		if (typeof item !== "object" || item === null) {
			return false;
		}
		const { id, x, y, w, h } = item as Record<string, unknown>;
		if (typeof id !== "string" || !WIDGET_PATTERN.test(id) || ids.has(id)) {
			return false;
		}
		ids.add(id);
		if (!isIntIn(w, 1, 5) || !isIntIn(h, 1, 6) || !isIntIn(x, 0, 5 - w) || !isIntIn(y, 0, 99)) {
			return false;
		}
	}
	return true;
};

export const isBrowseColumns = (value: unknown): value is number => isIntIn(value, 2, 8);

export const isAutoSkipIntroCredits = (value: unknown): value is boolean => typeof value === "boolean";

/** Allowed preference keys. Add an entry here to let the frontend persist a new setting. */
const PREFERENCE_VALIDATORS: Record<string, (value: unknown) => boolean> = {
	language: (value) => typeof value === "string" && value.length <= 35 && LANGUAGE_PATTERN.test(value),
	adminDashboardGrid: isDashboardGrid,
	browseColumns: isBrowseColumns,
	autoSkipIntroCredits: isAutoSkipIntroCredits,
};

export function publicPreferences(data: Record<string, unknown>): Preferences {
	const preferences: Preferences = {
		autoSkipIntroCredits: isAutoSkipIntroCredits(data.autoSkipIntroCredits) ? data.autoSkipIntroCredits : true,
	};
	if (typeof data.language === "string" && PREFERENCE_VALIDATORS.language(data.language)) {
		preferences.language = data.language;
	}
	if (isDashboardGrid(data.adminDashboardGrid)) {
		preferences.adminDashboardGrid = data.adminDashboardGrid;
	}
	if (isBrowseColumns(data.browseColumns)) {
		preferences.browseColumns = data.browseColumns;
	}
	return preferences;
}

@Injectable()
export class PreferencesService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	async get(authorization?: string): Promise<Preferences> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const row = await this.dataSource.getRepository(UserPreference).findOneBy({ userId: user.id });
		return publicPreferences(row?.data ?? {});
	}

	async update(patch: Record<string, unknown>, authorization?: string): Promise<Preferences> {
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
			const data: Record<string, unknown> = { ...row?.data };
			for (const [key, value] of Object.entries(patch)) {
				if (value === null) {
					delete data[key];
				} else {
					data[key] = value;
				}
			}
			await repository.upsert({ userId: user.id, data }, ["userId"]);
			return publicPreferences(data);
		});
	}
}
