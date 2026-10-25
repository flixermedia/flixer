import type { SegmentSource, SegmentType } from "../../entities/mediaSegment.entity.js";

export interface Chapter {
	title: string;
	startMs: number;
	endMs: number;
}

export interface ResolvedSegment {
	type: SegmentType;
	startMs: number;
	endMs: number;
	source: SegmentSource | "chapter";
}

/** Chapter titles that mark a segment, checked in order; the first match wins. */
const CHAPTER_PATTERNS: [SegmentType, RegExp][] = [
	["intro", /\b(intro|introduction|opening)\b|^op\s*\d*$/i],
	["commercial", /\b(break|ad|ads|advert|advertisement|intermission|commercial)\b/i],
	["preview", /\bpreview\b|next time on|next on|sneak peek/i],
	["recap", /\brecap\b|last time on|previously on|last on/i],
	["credits", /\b(outro|closing|credits|ending)\b|^ed\s*\d*$/i],
];

/** Lower number wins when several sources describe the same segment type. */
const SOURCE_PRIORITY: Record<ResolvedSegment["source"], number> = { manual: 0, skipme: 1, chapter: 2 };

/** Reads the chapter list ffprobe stored with an item, dropping malformed entries. */
export function parseChapters(technical: Record<string, unknown> | null | undefined): Chapter[] {
	const raw = technical?.chapters;
	if (!Array.isArray(raw)) {
		return [];
	}
	const chapters: Chapter[] = [];
	for (const entry of raw as Record<string, unknown>[]) {
		const start = Number(entry?.start);
		const end = Number(entry?.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) {
			continue;
		}
		chapters.push({ title: typeof entry.title === "string" ? entry.title : "", startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
	}
	return chapters.sort((a, b) => a.startMs - b.startMs);
}

/** Turns chapters whose titles look like an intro, recap, credits, … into segments. */
export function chapterSegments(chapters: Chapter[]): ResolvedSegment[] {
	const segments: ResolvedSegment[] = [];
	for (const chapter of chapters) {
		const match = CHAPTER_PATTERNS.find(([, pattern]) => pattern.test(chapter.title.trim()));
		if (match) {
			segments.push({ type: match[0], startMs: chapter.startMs, endMs: chapter.endMs, source: "chapter" });
		}
	}
	return segments;
}

/** Keeps one segment per type, preferring manual edits over crowd-sourced data over chapters. */
export function mergeSegments(candidates: ResolvedSegment[]): ResolvedSegment[] {
	const best = new Map<SegmentType, ResolvedSegment>();
	for (const candidate of candidates) {
		const current = best.get(candidate.type);
		if (!current || SOURCE_PRIORITY[candidate.source] < SOURCE_PRIORITY[current.source]) {
			best.set(candidate.type, candidate);
		}
	}
	return [...best.values()].sort((a, b) => a.startMs - b.startMs);
}

export interface SkipmeTimestamp {
	start_ms?: number;
	end_ms?: number | null;
	duration_ms?: number;
	submissions?: number;
}

const DURATION_TOLERANCE_MS = 5000;

/** Picks the crowd-sourced entry recorded against a file of about the same length, favouring the most submissions. */
export function pickSkipmeTimestamp(entries: SkipmeTimestamp[] | undefined, durationMs: number): { startMs: number; endMs: number; submissions: number } | null {
	let best: SkipmeTimestamp | null = null;
	for (const entry of entries ?? []) {
		if (!Number.isFinite(entry.start_ms) || !Number.isFinite(entry.end_ms) || (entry.end_ms as number) <= (entry.start_ms as number)) {
			continue;
		}
		if (durationMs > 0 && entry.duration_ms && Math.abs(entry.duration_ms - durationMs) > DURATION_TOLERANCE_MS) {
			continue;
		}
		if (!best || (entry.submissions ?? 0) > (best.submissions ?? 0)) {
			best = entry;
		}
	}
	return best ? { startMs: Math.round(best.start_ms as number), endMs: Math.round(best.end_ms as number), submissions: best.submissions ?? 0 } : null;
}

/** Admin setting holding the SkipMe.db base URL; its default is seeded by a migration. */
export const SKIPME_API_URL_KEY = "skipme_api_url";
