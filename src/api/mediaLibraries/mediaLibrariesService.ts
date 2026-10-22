import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaLibrary, type MediaImageStorage, type MediaLibraryFolder, type MediaLibraryType } from "../../entities/mediaLibrary.entity.js";
import { MediaRootsService, parseRelativePath, type MediaRoot } from "./mediaRootsService.js";

export interface PublicMediaLibraryFolder extends MediaLibraryFolder {
	rootName: string;
	/** Absolute location on the server, shown to admins only. */
	location: string;
	available: boolean;
}

export interface PublicMediaLibrary {
	id: string;
	name: string;
	type: MediaLibraryType;
	imageStorage: MediaImageStorage;
	folders: PublicMediaLibraryFolder[];
	createdAt: Date;
}

interface LibraryInput {
	name?: string;
	type?: MediaLibraryType;
	imageStorage?: MediaImageStorage;
	folders?: MediaLibraryFolder[];
}

const UNIQUE_VIOLATION = "23505";

/** Admin-defined media libraries (Movies, TV Shows, Music...) built from folders inside the media roots. */
@Injectable()
export class MediaLibrariesService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly roots: MediaRootsService,
	) {}

	async list(): Promise<PublicMediaLibrary[]> {
		const libraries = await this.entities();
		const roots = this.roots.list();
		return Promise.all(libraries.map((library) => this.toPublic(library, roots)));
	}

	/** Libraries as flixer-indexer sees them, with each folder's absolute location on this server. */
	async forIndexer() {
		const roots = this.roots.list();
		return (await this.entities()).map((library) => ({
			id: library.id,
			name: library.name,
			type: library.type,
			imageStorage: library.imageStorage,
			folders: library.folders.flatMap((folder) => {
				const root = roots.find((entry) => entry.id === folder.rootId);
				return root ? [{ rootId: folder.rootId, path: folder.path, absolutePath: join(root.path, ...parseRelativePath(folder.path)) }] : [];
			}),
		}));
	}

	/** Raw libraries, used by playback to find the media files. */
	async entities(): Promise<MediaLibrary[]> {
		return this.dataSource.getRepository(MediaLibrary).find({ order: { name: "ASC" } });
	}

	async create(input: Required<Pick<LibraryInput, "name" | "type" | "folders">> & Pick<LibraryInput, "imageStorage">): Promise<PublicMediaLibrary> {
		const repository = this.dataSource.getRepository(MediaLibrary);
		const library = repository.create({
			id: randomUUID(),
			name: input.name.trim(),
			type: input.type,
			imageStorage: input.imageStorage ?? "cache",
			folders: await this.validateFolders(input.folders),
		});
		return this.toPublic(await this.save(library), this.roots.list());
	}

	async update(id: string, input: LibraryInput): Promise<PublicMediaLibrary> {
		const library = await this.dataSource.getRepository(MediaLibrary).findOneBy({ id });
		if (!library) {
			throw new NotFound("Media library not found.");
		}
		if (input.name !== undefined) {
			library.name = input.name.trim();
		}
		if (input.type !== undefined) {
			library.type = input.type;
		}
		if (input.imageStorage !== undefined) {
			library.imageStorage = input.imageStorage;
		}
		if (input.folders !== undefined) {
			library.folders = await this.validateFolders(input.folders);
		}
		return this.toPublic(await this.save(library), this.roots.list());
	}

	async remove(id: string): Promise<boolean> {
		const result = await this.dataSource.getRepository(MediaLibrary).delete({ id });
		return (result.affected ?? 0) > 0;
	}

	private async save(library: MediaLibrary): Promise<MediaLibrary> {
		if (!library.name) {
			throw new BadRequest("A library needs a name.");
		}
		try {
			return await this.dataSource.getRepository(MediaLibrary).save(library);
		} catch (error) {
			if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
				throw new Conflict("A media library with this name already exists.");
			}
			throw error;
		}
	}

	private async validateFolders(folders: MediaLibraryFolder[]): Promise<MediaLibraryFolder[]> {
		const unique = new Map<string, MediaLibraryFolder>();
		for (const folder of folders) {
			const path = parseRelativePath(folder.path).join("/");
			await this.roots.resolveDirectory(folder.rootId, path);
			unique.set(`${folder.rootId}/${path}`, { rootId: folder.rootId, path });
		}
		if (unique.size === 0) {
			throw new BadRequest("A library needs at least one folder.");
		}
		return [...unique.values()];
	}

	private async toPublic(library: MediaLibrary, roots: MediaRoot[]): Promise<PublicMediaLibrary> {
		const folders = await Promise.all(
			library.folders.map(async (folder) => {
				const root = roots.find((entry) => entry.id === folder.rootId);
				const available = root ? await this.roots.resolveDirectory(root.id, folder.path).then(() => true, () => false) : false;
				return {
					...folder,
					rootName: root?.name ?? "",
					location: root ? [root.path, ...parseRelativePath(folder.path)].join("/").replace(/\\/g, "/") : "",
					available,
				};
			}),
		);
		return { id: library.id, name: library.name, type: library.type, imageStorage: library.imageStorage, folders, createdAt: library.createdAt };
	}
}
