import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Forbidden, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { Theme } from "../../entities/theme.entity.js";
import { ThemeVersion } from "../../entities/themeVersion.entity.js";
import { AuthService } from "../auth/authService.js";
import { BUILT_IN_THEME_IDS, DEFAULT_THEME_ID } from "./builtInThemes.js";
import {
	THEME_DESCRIPTION_MAX,
	THEME_FILE_FORMAT,
	THEME_FILE_MAX_CHARS,
	THEME_FILE_VERSION,
	THEME_NAME_MAX,
	cleanText,
	sanitizeLibraryAccents,
	sanitizeSchedules,
	scheduledThemeId,
	type ThemeSchedule,
	parseThemeFile,
	sanitizeThemeConfig,
	type ThemeConfig,
	type ThemeFile,
} from "./themeSchema.js";

export const ACTIVE_THEME_SETTING = "active_theme_id";
export const USER_SELECTION_SETTING = "theme_user_selection_enabled";
export const SELECTABLE_THEMES_SETTING = "theme_user_selectable_ids";
export const SCHEDULES_SETTING = "theme_schedules";
export const LIBRARY_ACCENTS_SETTING = "theme_library_accents";
export const APPEARANCE_SETTING_KEYS: readonly string[] = [ACTIVE_THEME_SETTING, USER_SELECTION_SETTING, SELECTABLE_THEMES_SETTING, SCHEDULES_SETTING, LIBRARY_ACCENTS_SETTING];

const MAX_CUSTOM_THEMES = 50;
const MAX_VERSIONS = 20;

export interface ThemeView {
	id: string;
	name: string;
	description: string;
	builtIn: boolean;
	config: ThemeConfig;
	createdAt: Date;
	updatedAt: Date;
}

export interface ThemeVersionView {
	id: string;
	name: string;
	description: string;
	config: ThemeConfig;
	createdAt: Date;
}

export interface AppearanceState {
	/** The theme chosen by the admin. */
	activeThemeId: string;
	/** The theme visitors actually get today: the active theme unless a schedule overrides it. */
	effectiveThemeId: string;
	userSelectionEnabled: boolean;
	selectableThemeIds: string[];
	schedules: ThemeSchedule[];
	libraryAccents: Record<string, string>;
	themes: ThemeView[];
}

export interface PublicAppearance {
	activeThemeId: string;
	userSelectionEnabled: boolean;
	libraryAccents: Record<string, string>;
	themes: ThemeView[];
}

/** PNG width and height from the header, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
	if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) {
		return null;
	}
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function themeId(value: unknown): string {
	if (typeof value !== "string" || !AuthService.isUuid(value)) {
		throw new NotFound("That theme does not exist.");
	}
	return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new BadRequest(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

@Injectable()
export class AppearanceService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	private view(theme: Theme): ThemeView {
		return {
			id: theme.id,
			name: theme.name,
			description: theme.description,
			builtIn: theme.isBuiltIn,
			config: theme.config,
			createdAt: theme.createdAt,
			updatedAt: theme.updatedAt,
		};
	}

	private async readSettings(): Promise<{ activeThemeId: string; userSelectionEnabled: boolean; selectableThemeIds: string[]; schedules: ThemeSchedule[]; libraryAccents: Record<string, string> }> {
		const rows = await this.dataSource.getRepository(Setting).findBy({ key: In([...APPEARANCE_SETTING_KEYS]) });
		const value = (key: string) => rows.find((row) => row.key === key)?.value;
		const active = value(ACTIVE_THEME_SETTING);
		const selectable = value(SELECTABLE_THEMES_SETTING);
		return {
			activeThemeId: typeof active === "string" ? active : DEFAULT_THEME_ID,
			userSelectionEnabled: value(USER_SELECTION_SETTING) === true,
			selectableThemeIds: Array.isArray(selectable) ? selectable.filter((id): id is string => typeof id === "string") : [],
			schedules: this.storedSchedules(value(SCHEDULES_SETTING)),
			libraryAccents: this.storedAccents(value(LIBRARY_ACCENTS_SETTING)),
		};
	}

	private storedSchedules(value: unknown): ThemeSchedule[] {
		try {
			return sanitizeSchedules(value ?? []);
		} catch {
			return [];
		}
	}

	private storedAccents(value: unknown): Record<string, string> {
		try {
			return sanitizeLibraryAccents(value ?? {});
		} catch {
			return {};
		}
	}

	private async writeSetting(key: string, value: unknown): Promise<void> {
		await this.dataSource.getRepository(Setting).upsert({ key, value, isPublic: false }, ["key"]);
	}

	/** What every visitor needs to render the app: the active theme, plus the ones users may choose between. */
	async publicState(): Promise<PublicAppearance> {
		const settings = await this.readSettings();
		const repository = this.dataSource.getRepository(Theme);
		const scheduled = scheduledThemeId(settings.schedules, new Date());
		const baseId = scheduled && (await repository.existsBy({ id: scheduled })) ? scheduled : settings.activeThemeId;
		const wanted = new Set<string>([baseId]);
		if (settings.userSelectionEnabled) {
			for (const id of settings.selectableThemeIds) {
				wanted.add(id);
			}
		}
		let themes = await repository.findBy({ id: In([...wanted]) });
		let activeThemeId = baseId;
		if (!themes.some((theme) => theme.id === activeThemeId)) {
			activeThemeId = DEFAULT_THEME_ID;
			const fallback = await repository.findOneBy({ id: DEFAULT_THEME_ID });
			themes = fallback ? [...themes, fallback] : themes;
		}
		return { activeThemeId, userSelectionEnabled: settings.userSelectionEnabled, libraryAccents: settings.libraryAccents, themes: themes.map((theme) => this.view(theme)) };
	}

	async adminState(authorization?: string): Promise<AppearanceState> {
		await this.authService.requireAdmin(authorization);
		const settings = await this.readSettings();
		const themes = await this.dataSource.getRepository(Theme).find({ order: { isBuiltIn: "DESC", createdAt: "ASC", name: "ASC" } });
		const known = new Set(themes.map((theme) => theme.id));
		const activeThemeId = known.has(settings.activeThemeId) ? settings.activeThemeId : DEFAULT_THEME_ID;
		const scheduled = scheduledThemeId(settings.schedules, new Date());
		return {
			...settings,
			activeThemeId,
			effectiveThemeId: scheduled && known.has(scheduled) ? scheduled : activeThemeId,
			schedules: settings.schedules.filter((schedule) => known.has(schedule.themeId)),
			selectableThemeIds: settings.selectableThemeIds.filter((id) => known.has(id)),
			themes: themes.map((theme) => this.view(theme)),
		};
	}

	async saveSettings(body: unknown, authorization?: string): Promise<AppearanceState> {
		await this.authService.requireAdmin(authorization);
		const request = record(body, "Request");
		const repository = this.dataSource.getRepository(Theme);

		if (request.activeThemeId !== undefined) {
			if (typeof request.activeThemeId !== "string" || !AuthService.isUuid(request.activeThemeId) || !(await repository.existsBy({ id: request.activeThemeId }))) {
				throw new BadRequest("Choose an existing theme to apply.");
			}
			await this.writeSetting(ACTIVE_THEME_SETTING, request.activeThemeId);
		}
		if (request.userSelectionEnabled !== undefined) {
			if (typeof request.userSelectionEnabled !== "boolean") {
				throw new BadRequest("userSelectionEnabled must be true or false.");
			}
			await this.writeSetting(USER_SELECTION_SETTING, request.userSelectionEnabled);
		}
		if (request.selectableThemeIds !== undefined) {
			const ids = request.selectableThemeIds;
			if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string" || !AuthService.isUuid(id))) {
				throw new BadRequest("selectableThemeIds must be a list of theme ids.");
			}
			const unique = [...new Set(ids as string[])];
			if ((await repository.countBy({ id: In(unique) })) !== unique.length) {
				throw new BadRequest("Some of the chosen themes no longer exist.");
			}
			await this.writeSetting(SELECTABLE_THEMES_SETTING, unique);
		}
		if (request.schedules !== undefined) {
			const schedules = sanitizeSchedules(request.schedules);
			const ids = [...new Set(schedules.map((schedule) => schedule.themeId))];
			if ((await repository.countBy({ id: In(ids) })) !== ids.length) {
				throw new BadRequest("A schedule uses a theme that no longer exists.");
			}
			await this.writeSetting(SCHEDULES_SETTING, schedules);
		}
		if (request.libraryAccents !== undefined) {
			await this.writeSetting(LIBRARY_ACCENTS_SETTING, sanitizeLibraryAccents(request.libraryAccents));
		}
		return this.adminState(authorization);
	}

	private parseDraft(body: unknown): { name: string; description: string; config: ThemeConfig } {
		const request = record(body, "Request");
		return {
			name: cleanText(request.name, "Theme name", THEME_NAME_MAX, true),
			description: cleanText(request.description, "Theme description", THEME_DESCRIPTION_MAX, false),
			config: sanitizeThemeConfig(request.config),
		};
	}

	private async insert(draft: { name: string; description: string; config: ThemeConfig }): Promise<ThemeView> {
		const repository = this.dataSource.getRepository(Theme);
		if ((await repository.countBy({ isBuiltIn: false })) >= MAX_CUSTOM_THEMES) {
			throw new BadRequest(`You can keep at most ${MAX_CUSTOM_THEMES} custom themes. Delete one first.`);
		}
		const theme = repository.create({ id: randomUUID(), ...draft, isBuiltIn: false });
		return this.view(await repository.save(theme));
	}

	async create(body: unknown, authorization?: string): Promise<ThemeView> {
		await this.authService.requireAdmin(authorization);
		return this.insert(this.parseDraft(body));
	}

	private async customTheme(id: string): Promise<Theme> {
		const theme = await this.dataSource.getRepository(Theme).findOneBy({ id: themeId(id) });
		if (!theme) {
			throw new NotFound("That theme does not exist.");
		}
		if (theme.isBuiltIn || BUILT_IN_THEME_IDS.has(theme.id)) {
			throw new Forbidden("Built-in themes cannot be changed. Duplicate it to make your own version.");
		}
		return theme;
	}

	async update(id: string, body: unknown, authorization?: string): Promise<ThemeView> {
		await this.authService.requireAdmin(authorization);
		const theme = await this.customTheme(id);
		const draft = this.parseDraft(body);
		await this.snapshot(theme);
		theme.name = draft.name;
		theme.description = draft.description;
		theme.config = draft.config;
		return this.view(await this.dataSource.getRepository(Theme).save(theme));
	}

	/** Keeps what the theme looked like before a change so it can be restored later. */
	private async snapshot(theme: Theme): Promise<void> {
		const repository = this.dataSource.getRepository(ThemeVersion);
		await repository.save(repository.create({ id: randomUUID(), themeId: theme.id, name: theme.name, description: theme.description, config: theme.config }));
		const stale = await repository.find({ where: { themeId: theme.id }, order: { createdAt: "DESC" }, skip: MAX_VERSIONS, select: { id: true } });
		if (stale.length > 0) {
			await repository.delete({ id: In(stale.map((version) => version.id)) });
		}
	}

	async listVersions(id: string, authorization?: string): Promise<ThemeVersionView[]> {
		await this.authService.requireAdmin(authorization);
		const theme = await this.customTheme(id);
		const versions = await this.dataSource.getRepository(ThemeVersion).find({ where: { themeId: theme.id }, order: { createdAt: "DESC" } });
		return versions.map(({ id: versionId, name, description, config, createdAt }) => ({ id: versionId, name, description, config, createdAt }));
	}

	async restoreVersion(id: string, versionId: string, authorization?: string): Promise<ThemeView> {
		await this.authService.requireAdmin(authorization);
		const theme = await this.customTheme(id);
		const version = await this.dataSource.getRepository(ThemeVersion).findOneBy({ id: themeId(versionId), themeId: theme.id });
		if (!version) {
			throw new NotFound("That version does not exist.");
		}
		await this.snapshot(theme);
		theme.name = version.name;
		theme.description = version.description;
		theme.config = sanitizeThemeConfig(version.config);
		return this.view(await this.dataSource.getRepository(Theme).save(theme));
	}

	/** The web app manifest for installed copies of the app, named and coloured like the theme in use. */
	async manifest(requested?: string): Promise<Record<string, unknown>> {
		const state = await this.publicState();
		const allowed = state.userSelectionEnabled ? state.themes : state.themes.filter((theme) => theme.id === state.activeThemeId);
		const theme = (requested && allowed.find((candidate) => candidate.id === requested)) || state.themes.find((candidate) => candidate.id === state.activeThemeId) || state.themes[0];
		const name = theme?.config.branding.appName?.trim() || "Flixer";
		const background = theme?.config.colors.dark.background ?? "#080811";
		const icons: Record<string, string>[] = [
			{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
			{ src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
			{ src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		];
		const custom = theme ? this.rasterIcon(theme) : null;
		if (theme && custom) {
			icons.unshift({ src: `/api/appearance/icon/${theme.id}`, sizes: `${custom.width}x${custom.height}`, type: "image/png" });
		}
		return {
			name,
			short_name: name.slice(0, 12),
			description: "Your personal streaming experience.",
			start_url: "/",
			scope: "/",
			display: "standalone",
			background_color: background,
			theme_color: background,
			icons,
		};
	}

	private rasterIcon(theme: ThemeView): { bytes: Buffer; width: number; height: number } | null {
		const match = /^data:image\/png;base64,(.+)$/.exec(theme.config.branding.favicon ?? "");
		if (!match) {
			return null;
		}
		const bytes = Buffer.from(match[1], "base64");
		const size = pngSize(bytes);
		return size && size.width === size.height && size.width >= 192 ? { bytes, ...size } : null;
	}

	/** The theme's square PNG favicon, served so the manifest can point at it. */
	async icon(id: string): Promise<Buffer> {
		const theme = await this.dataSource.getRepository(Theme).findOneBy({ id: themeId(id) });
		const icon = theme ? this.rasterIcon(this.view(theme)) : null;
		if (!icon) {
			throw new NotFound("This theme has no installable icon.");
		}
		return icon.bytes;
	}

	async duplicate(id: string, authorization?: string): Promise<ThemeView> {
		await this.authService.requireAdmin(authorization);
		const source = await this.dataSource.getRepository(Theme).findOneBy({ id: themeId(id) });
		if (!source) {
			throw new NotFound("That theme does not exist.");
		}
		const suffix = " copy";
		return this.insert({
			name: `${source.name.slice(0, THEME_NAME_MAX - suffix.length)}${suffix}`,
			description: source.description,
			config: source.config,
		});
	}

	async remove(id: string, authorization?: string): Promise<void> {
		await this.authService.requireAdmin(authorization);
		const theme = await this.customTheme(id);
		const settings = await this.readSettings();
		if (settings.activeThemeId === theme.id) {
			throw new BadRequest("This theme is in use. Apply another theme before deleting it.");
		}
		await this.dataSource.getRepository(Theme).delete({ id: theme.id });
		if (settings.schedules.some((schedule) => schedule.themeId === theme.id)) {
			await this.writeSetting(SCHEDULES_SETTING, settings.schedules.filter((schedule) => schedule.themeId !== theme.id));
		}
		if (settings.selectableThemeIds.includes(theme.id)) {
			await this.writeSetting(SELECTABLE_THEMES_SETTING, settings.selectableThemeIds.filter((other) => other !== theme.id));
		}
	}

	async exportTheme(id: string, authorization?: string): Promise<ThemeFile> {
		await this.authService.requireAdmin(authorization);
		const theme = await this.dataSource.getRepository(Theme).findOneBy({ id: themeId(id) });
		if (!theme) {
			throw new NotFound("That theme does not exist.");
		}
		return {
			format: THEME_FILE_FORMAT,
			version: THEME_FILE_VERSION,
			exportedAt: new Date().toISOString(),
			theme: { name: theme.name, description: theme.description, config: theme.config },
		};
	}

	/** Checks an uploaded theme file and returns its cleaned contents without saving anything. */
	async previewImport(body: unknown, authorization?: string): Promise<{ name: string; description: string; config: ThemeConfig }> {
		await this.authService.requireAdmin(authorization);
		const request = record(body, "Request");
		const file = request.file;
		if (typeof file === "string") {
			if (file.length > THEME_FILE_MAX_CHARS) {
				throw new BadRequest("This theme file is too large.");
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(file);
			} catch {
				throw new BadRequest("This file is not valid JSON.");
			}
			return parseThemeFile(parsed);
		}
		return parseThemeFile(file);
	}

	async importTheme(body: unknown, authorization?: string): Promise<ThemeView> {
		const draft = await this.previewImport(body, authorization);
		return this.insert(draft);
	}
}
