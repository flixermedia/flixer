/**
 * Maps the rating labels found in library metadata (MPAA, TV Parental Guidelines, BBFC, FSK, ACB, bare ages)
 * to a minimum viewing age, so a single "maximum age" limit works across countries.
 */
const RATING_AGES: Record<string, number> = {
	G: 0,
	"TV-Y": 0,
	"TV-G": 0,
	U: 0,
	UC: 0,
	"FSK-0": 0,
	"TV-Y7": 7,
	"TV-Y7-FV": 7,
	"FSK-6": 6,
	PG: 8,
	"TV-PG": 10,
	"PG-13": 13,
	"TV-14": 14,
	"12A": 12,
	"FSK-12": 12,
	M: 15,
	"MA15+": 15,
	"FSK-16": 16,
	R: 17,
	"TV-MA": 17,
	"NC-17": 18,
	"R18+": 18,
	R18: 18,
	X: 18,
	"FSK-18": 18,
};

/** Labels that mean "not rated", which parents may want to block separately from explicit ratings. */
export const UNRATED_LABELS = ["NR", "NOT-RATED", "UNRATED", "UR", "NOT-RATED.", "NONE", "N/A"];

/** The limits an administrator can pick from, with the labels they cover. */
export const RATING_LIMITS: ReadonlyArray<{ age: number; label: string; examples: string }> = [
	{ age: 0, label: "All ages", examples: "G, TV-Y, TV-G, U" },
	{ age: 7, label: "Ages 7+", examples: "TV-Y7" },
	{ age: 8, label: "Ages 8+", examples: "PG" },
	{ age: 10, label: "Ages 10+", examples: "TV-PG" },
	{ age: 13, label: "Ages 13+", examples: "PG-13" },
	{ age: 14, label: "Ages 14+", examples: "TV-14" },
	{ age: 16, label: "Ages 16+", examples: "FSK 16" },
	{ age: 17, label: "Ages 17+", examples: "R, TV-MA" },
	{ age: 18, label: "Adults only", examples: "NC-17, 18, X" },
];

function normalise(raw: string): string {
	return raw
		.trim()
		.toUpperCase()
		.replace(/^[A-Z]{2}[:/]/, "")
		.replace(/\s+/g, "-");
}

/** The minimum age for a rating label, or null when it is unrated or unrecognised. */
export function ratingToAge(raw: string | null | undefined): number | null {
	if (!raw) return null;
	const label = normalise(raw);
	if (label in RATING_AGES) return RATING_AGES[label];
	const bare = /^(?:FSK-)?(\d{1,2})\+?$/.exec(label);
	return bare ? Number(bare[1]) : null;
}

/**
 * The same mapping as a Postgres expression, so limits are enforced inside queries and pagination stays correct.
 * `rawSql` must be a trusted SQL expression yielding the rating text.
 */
export function ratingAgeSql(rawSql: string): string {
	const label = `regexp_replace(regexp_replace(upper(btrim(${rawSql})), '^[A-Z]{2}[:/]', ''), '\\s+', '-', 'g')`;
	const cases = Object.entries(RATING_AGES)
		.map(([key, age]) => `WHEN '${key.replace(/'/g, "''")}' THEN ${age}`)
		.join(" ");
	const bare = `CASE WHEN ${label} ~ '^(FSK-)?[0-9]{1,2}\\+?$' THEN regexp_replace(${label}, '[^0-9]', '', 'g')::int END`;
	return `(CASE ${label} ${cases} ELSE ${bare} END)`;
}
