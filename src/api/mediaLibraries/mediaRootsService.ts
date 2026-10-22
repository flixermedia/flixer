import { Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, delimiter, join, relative, resolve, sep } from "node:path";
import { NetworkSharesService } from "../networkShares/networkSharesService.js";

export interface MediaRoot {
	id: string;
	name: string;
	path: string;
}

export interface BrowseResult {
	rootId: string;
	path: string;
	directories: string[];
}

const DEFAULT_MEDIA_ROOT = "../flixer-data/media";

/** Splits a relative path into validated segments; rejects anything that could escape the root. */
export function parseRelativePath(value: string): string[] {
	const segments = value.split("/").filter((segment) => segment !== "");
	for (const segment of segments) {
		if (segment === "." || segment === ".." || /[\\:\0]/.test(segment)) {
			throw new BadRequest("Invalid folder path.");
		}
	}
	return segments;
}

/**
 * The root media folders flixer and flixer-streamer are pointed at (STREAM_MEDIA_ROOT). Admins pick
 * folders inside these roots when they set up their own media libraries.
 */
@Injectable()
export class MediaRootsService {

	constructor(private readonly shares: NetworkSharesService) {}

	/** Reads STREAM_MEDIA_ROOT, falling back to MEDIA_PATH. May be a JSON array, a path list (; on Windows, : elsewhere) or one path. */
	list(): MediaRoot[] {
		const raw = process.env.STREAM_MEDIA_ROOT?.trim() || process.env.MEDIA_PATH?.trim() || DEFAULT_MEDIA_ROOT;
		let paths: unknown;
		if (raw.startsWith("[")) {
			try {
				paths = JSON.parse(raw);
			} catch {
				throw new Error("STREAM_MEDIA_ROOT is not a valid JSON array.");
			}
		} else {
			paths = raw.split(delimiter);
		}
		if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== "string")) {
			throw new Error("STREAM_MEDIA_ROOT must be a list of paths.");
		}

		const roots = new Map<string, MediaRoot>();
		for (const entry of paths as string[]) {
			if (!entry.trim()) {
				continue;
			}
			const path = resolve(entry.trim());
			const id = `root-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
			roots.set(id, { id, name: basename(path) || path, path });
		}
		for (const root of this.shares.roots()) {
			roots.set(root.id, root);
		}
		return [...roots.values()];
	}

	get(rootId: string): MediaRoot {
		const root = this.list().find((entry) => entry.id === rootId);
		if (!root) {
			throw new NotFound("Media root not found.");
		}
		return root;
	}

	/** Resolves a folder inside a root to its canonical path, ensuring it exists and stays inside the root. */
	async resolveDirectory(rootId: string, path: string): Promise<string> {
		const root = this.get(rootId);
		const candidate = join(root.path, ...parseRelativePath(path));
		let canonicalRoot: string;
		let canonical: string;
		try {
			canonicalRoot = await realpath(root.path);
			canonical = await realpath(candidate);
			if (!(await stat(canonical)).isDirectory()) {
				throw new Error("not a directory");
			}
		} catch {
			throw new BadRequest("Folder does not exist.");
		}
		const rel = relative(canonicalRoot, canonical);
		if (rel === ".." || rel.startsWith(`..${sep}`)) {
			throw new BadRequest("Folder is outside the media root.");
		}
		return canonical;
	}

	async browse(rootId: string, path: string): Promise<BrowseResult> {
		const directory = await this.resolveDirectory(rootId, path);
		const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
			throw new BadRequest("Folder cannot be read.");
		});
		const directories = entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b));
		return { rootId, path: parseRelativePath(path).join("/"), directories };
	}
}
