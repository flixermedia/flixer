import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, Like } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { AuthService } from "../auth/authService.js";
import { LOGIN_LAYOUT_SETTING } from "./appearanceService.js";
import { sanitizePageContent, sanitizePageDraft, type BuilderPage, type PageBlock, type PublishedPage } from "./pageBuilderSchema.js";

const PREFIX = "page-builder:";
const LOGIN_ID = "login";
const SITE_SETTING = "page-builder-site";
const TEMPLATES_SETTING = "page-builder-templates";
interface PageSiteSettings {
	homePageId: string | null;
	navigationIds: string[];
}
interface ReusablePageBlock {
	id: string;
	name: string;
	block: PageBlock;
}

function initialLogin(): BuilderPage {
	return { id: LOGIN_ID, title: "Login", slug: "login", kind: "login", draft: { blocks: [{ id: "auth", type: "auth", text: "", image: null }] }, published: null };
}

function snapshot(page: BuilderPage): PublishedPage {

	const validated = sanitizePageDraft(page, page.kind);
	return { title: validated.title, slug: validated.slug, access: validated.access, ...validated.draft };

}

function publishSnapshot(page: BuilderPage, content: PublishedPage): BuilderPage {

	const version = { id: randomUUID(), createdAt: new Date().toISOString(), content };
	return { ...page, published: content, scheduled: null, history: [version, ...(page.history ?? [])].slice(0, 20) };

}

@Injectable()
export class PageBuilderService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly auth: AuthService,
	) {}

	private async pages(): Promise<BuilderPage[]> {
		const rows = await this.dataSource.getRepository(Setting).findBy({ key: Like(`${PREFIX}%`) });
		const pages = rows.map((row) => row.value as BuilderPage).filter((page) => page && typeof page.id === "string");
		if (!pages.some((page) => page.id === LOGIN_ID)) pages.unshift(initialLogin());
		return pages;
	}

	private async write(page: BuilderPage): Promise<void> {
		await this.dataSource.getRepository(Setting).upsert({ key: `${PREFIX}${page.id}`, value: page, isPublic: false }, ["key"]);
	}

	async list(authorization?: string): Promise<BuilderPage[]> {
		await this.auth.requireAdmin(authorization);
		return this.pages();
	}

	private async site(): Promise<PageSiteSettings> {
		const row = await this.dataSource.getRepository(Setting).findOneBy({ key: SITE_SETTING });
		const value = row?.value as Partial<PageSiteSettings> | undefined;
		return { homePageId: typeof value?.homePageId === "string" ? value.homePageId : null, navigationIds: Array.isArray(value?.navigationIds) ? value.navigationIds.filter((id): id is string => typeof id === "string") : [] };
	}

	async adminSite(authorization?: string): Promise<PageSiteSettings> {
		await this.auth.requireAdmin(authorization);
		return this.site();
	}

	async templates(authorization?: string): Promise<ReusablePageBlock[]> {
		await this.auth.requireAdmin(authorization);
		const row = await this.dataSource.getRepository(Setting).findOneBy({ key: TEMPLATES_SETTING });
		return Array.isArray(row?.value) ? (row.value as ReusablePageBlock[]) : [];
	}

	async createTemplate(input: unknown, authorization?: string): Promise<ReusablePageBlock> {
		const entries = await this.templates(authorization);
		if (entries.length >= 20 || !input || typeof input !== "object" || Array.isArray(input)) throw new BadRequest("Invalid reusable block.");
		const source = input as Record<string, unknown>;
		if (typeof source.name !== "string" || !source.name.trim() || source.name.length > 80) throw new BadRequest("A reusable block needs a name.");
		const block = sanitizePageContent({ blocks: [source.block] }, "page").blocks[0];
		const created = { id: randomUUID(), name: source.name.trim(), block };
		await this.dataSource.getRepository(Setting).upsert({ key: TEMPLATES_SETTING, value: [...entries, created], isPublic: false }, ["key"]);
		return created;
	}

	async removeTemplate(id: string, authorization?: string): Promise<void> {
		const entries = await this.templates(authorization);
		await this.dataSource.getRepository(Setting).upsert({ key: TEMPLATES_SETTING, value: entries.filter((entry) => entry.id !== id), isPublic: false }, ["key"]);
	}

	async saveSite(input: unknown, authorization?: string): Promise<PageSiteSettings> {
		await this.auth.requireAdmin(authorization);
		if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequest("Invalid site settings.");
		const data = input as Record<string, unknown>;
		if ((data.homePageId !== null && typeof data.homePageId !== "string") || !Array.isArray(data.navigationIds) || data.navigationIds.length > 49 || data.navigationIds.some((id) => typeof id !== "string")) throw new BadRequest("Invalid site settings.");
		const pages = await this.pages();
		const available = new Set(pages.filter((page) => page.kind === "page" && page.published).map((page) => page.id));
		if ((data.homePageId && !available.has(data.homePageId as string)) || data.navigationIds.some((id) => !available.has(id))) throw new BadRequest("Choose published pages.");
		const settings: PageSiteSettings = { homePageId: data.homePageId as string | null, navigationIds: [...new Set(data.navigationIds as string[])] };
		await this.dataSource.getRepository(Setting).upsert({ key: SITE_SETTING, value: settings, isPublic: false }, ["key"]);
		return settings;
	}

	async navigation(authorization?: string): Promise<{ title: string; slug: string }[]> {
		const signedIn = authorization ? !!(await this.auth.getAuthenticatedUser(authorization)) : false;
		const [settings, pages] = await Promise.all([this.site(), this.pages()]);
		return settings.navigationIds.flatMap((id) => {
			const page = pages.find((item) => item.id === id && item.kind === "page")?.published;
			return page && (page.access !== "signed-in" || signedIn) ? [{ title: page.title, slug: page.slug }] : [];
		});
	}

	async home(authorization?: string): Promise<PublishedPage> {
		const [settings, pages] = await Promise.all([this.site(), this.pages()]);
		const page = pages.find((item) => item.id === settings.homePageId && item.kind === "page")?.published;
		if (!page) throw new NotFound("Home page not found.");
		return this.publicPage(page.slug, authorization);
	}

	async create(authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const pages = await this.pages();
		if (pages.length >= 50) throw new BadRequest("You can create at most 49 pages.");
		const id = randomUUID();
		const page: BuilderPage = { id, title: "New page", slug: `page-${id}`, kind: "page", draft: { blocks: [] }, published: null };
		await this.write(page);
		return page;
	}

	async save(id: string, input: unknown, authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const pages = await this.pages();
		const page = pages.find((item) => item.id === id);
		if (!page) throw new NotFound("Page not found.");
		const draft = sanitizePageDraft(input, page.kind);
		if (pages.some((other) => other.id !== id && (other.slug === draft.slug || other.published?.slug === draft.slug || other.scheduled?.content.slug === draft.slug))) throw new BadRequest("That page address is already in use.");
		const updated = { ...page, ...draft };
		await this.write(updated);
		return updated;
	}

	async publish(id: string, authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const page = (await this.pages()).find((item) => item.id === id);
		if (!page) throw new NotFound("Page not found.");
		const updated = publishSnapshot(page, snapshot(page));
		await this.write(updated);
		return updated;
	}

	async remove(id: string, authorization?: string): Promise<void> {
		await this.auth.requireAdmin(authorization);
		if (id === LOGIN_ID) throw new BadRequest("The login page cannot be deleted.");
		await this.dataSource.getRepository(Setting).delete({ key: `${PREFIX}${id}` });
	}

	async unpublish(id: string, authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const page = (await this.pages()).find((item) => item.id === id);
		if (!page) throw new NotFound("Page not found.");
		const updated = { ...page, published: null, scheduled: null };
		await this.write(updated);
		if (id === LOGIN_ID) {
			const repository = this.dataSource.getRepository(Setting);
			const layout = await repository.findOneBy({ key: LOGIN_LAYOUT_SETTING });
			if (layout?.value === "custom") await repository.upsert({ key: LOGIN_LAYOUT_SETTING, value: "classic", isPublic: false }, ["key"]);
		}
		return updated;
	}

	async schedule(id: string, input: unknown, authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const page = (await this.pages()).find((item) => item.id === id);
		if (!page) throw new NotFound("Page not found.");
		const at = typeof input === "object" && input !== null && "at" in input ? (input as { at: unknown }).at : undefined;
		if (typeof at !== "string" || !Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now()) throw new BadRequest("Choose a future publication time.");
		const updated = { ...page, scheduled: { at: new Date(at).toISOString(), content: snapshot(page) } };
		await this.write(updated);
		return updated;
	}

	async cancelSchedule(id: string, authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const page = (await this.pages()).find((item) => item.id === id);
		if (!page) throw new NotFound("Page not found.");
		const updated = { ...page, scheduled: null };
		await this.write(updated);
		return updated;
	}

	async restore(id: string, versionId: string, authorization?: string): Promise<BuilderPage> {
		await this.auth.requireAdmin(authorization);
		const pages = await this.pages();
		const page = pages.find((item) => item.id === id);
		const version = page?.history?.find((item) => item.id === versionId);
		if (!page || !version) throw new NotFound("Page version not found.");
		const restored = sanitizePageDraft({ ...version.content, draft: version.content }, page.kind);
		if (pages.some((other) => other.id !== id && (other.slug === restored.slug || other.published?.slug === restored.slug || other.scheduled?.content.slug === restored.slug))) throw new BadRequest("That page address is already in use.");
		const updated = { ...page, ...restored };
		await this.write(updated);
		return updated;
	}

	async publishDue(now = new Date()): Promise<void> {
		for (const page of await this.pages()) {
			if (!page.scheduled || Date.parse(page.scheduled.at) > now.getTime()) continue;
			await this.dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(Setting);
				const row = await repository.findOne({ where: { key: `${PREFIX}${page.id}` }, lock: { mode: "pessimistic_write" } });
				const current = row?.value as BuilderPage | undefined;
				if (!current?.scheduled || Date.parse(current.scheduled.at) > now.getTime()) return;
				const safe = sanitizePageDraft({ ...current.scheduled.content, draft: current.scheduled.content }, current.kind);
				const published = { title: safe.title, slug: safe.slug, access: safe.access, ...safe.draft };
				await repository.upsert({ key: `${PREFIX}${current.id}`, value: publishSnapshot(current, published), isPublic: false }, ["key"]);
				if (current.kind === "login") await repository.upsert({ key: LOGIN_LAYOUT_SETTING, value: "custom", isPublic: false }, ["key"]);
			});
		}
	}

	async publicPage(slug: string, authorization?: string): Promise<PublishedPage> {
		const page = slug === LOGIN_ID ? ((await this.dataSource.getRepository(Setting).findOneBy({ key: `${PREFIX}${LOGIN_ID}` }))?.value as BuilderPage | undefined) : (await this.pages()).find((item) => item.kind === "page" && item.published?.slug === slug);
		if (!page?.published) throw new NotFound("Page not found.");
		const safe = sanitizePageDraft({ title: page.published.title, slug: page.published.slug, access: page.published.access, draft: page.published }, page.kind);
		if (safe.access === "signed-in") await this.auth.getAuthenticatedUser(authorization);
		return { title: safe.title, slug: safe.slug, access: safe.access, ...safe.draft };
	}
}
