const TIMESTAMP_TITLE = /^[ \t\r\n]*[0-9]{2,}:[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?[ \t\r\n]*$/;

export function normalizeChapterTitle(title: string, position: number): string {
	return TIMESTAMP_TITLE.test(title) ? `Chapter ${position}` : title;
}

/** Replaces timestamp-only chapter titles using their chronological position. */
export function normalizeChapterTitles(chapters: unknown[]): unknown[] {
	const ordered = chapters.map((chapter, index) => {
		const start = chapter !== null && typeof chapter === "object" && !Array.isArray(chapter)
			? (chapter as { start?: unknown }).start
			: undefined;
		return { index, start: typeof start === "number" && Number.isFinite(start) ? start : Infinity };
	}).sort((a, b) => a.start - b.start || a.index - b.index);
	const positions = new Map(ordered.map(({ index }, position) => [index, position + 1]));
	return chapters.map((chapter, index) => {
		if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) return chapter;
		const entry = chapter as Record<string, unknown>;
		if (typeof entry.title !== "string" || !TIMESTAMP_TITLE.test(entry.title)) return chapter;
		return { ...entry, title: normalizeChapterTitle(entry.title, positions.get(index)!) };
	});
}

export function normalizeChapterField(data: Record<string, unknown>, field: string): Record<string, unknown> {
	return Array.isArray(data[field]) ? { ...data, [field]: normalizeChapterTitles(data[field]) } : data;
}
