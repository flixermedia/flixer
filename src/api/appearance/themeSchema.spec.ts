import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES } from "./builtInThemes.js";
import { parseThemeFile, sanitizeCustomCss, sanitizeImage, sanitizeLibraryAccents, sanitizeSchedules, sanitizeThemeConfig, scheduledThemeId, THEME_FILE_FORMAT, THEME_FILE_VERSION } from "./themeSchema.js";

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("built-in themes", () => {
	it("ships five valid themes starting with Flixer Default", () => {
		expect(BUILT_IN_THEMES).toHaveLength(5);
		expect(BUILT_IN_THEMES[0].name).toBe("Flixer Default");
		for (const theme of BUILT_IN_THEMES) {
			expect(sanitizeThemeConfig(theme.config)).toEqual(theme.config);
		}
	});
});

describe("sanitizeThemeConfig", () => {
	const base = () => clone(BUILT_IN_THEMES[0].config);

	it("drops unknown fields and normalises short hex colours", () => {
		const input = { ...base(), evil: { __proto__: { polluted: true } } } as Record<string, unknown>;
		(input.colors as { dark: Record<string, string> }).dark.accent = "#ABC";
		const result = sanitizeThemeConfig(input);
		expect(result).not.toHaveProperty("evil");
		expect(result.colors.dark.accent).toBe("#aabbcc");
	});

	it.each([
		["a css colour function", (config: any) => (config.colors.dark.text = "red; background:url(x)")],
		["an out-of-range radius", (config: any) => (config.shape.radius = 9)],
		["an unknown layout option", (config: any) => (config.layout.density = "huge")],
		["a missing palette", (config: any) => delete config.colors.light],
	])("rejects %s", (_name, mutate) => {
		const config = base();
		mutate(config);
		expect(() => sanitizeThemeConfig(config)).toThrow();
	});

	it("strips markup characters from the app name", () => {
		const config = base();
		config.branding.appName = "  <b>My</b> Flix ";
		expect(sanitizeThemeConfig(config).branding.appName).toBe("bMy/b Flix");
	});
});

describe("sanitizeImage", () => {
	it("accepts a real PNG and rejects spoofed or remote images", () => {
		expect(sanitizeImage(png, "Logo")).toBe(png);
		expect(() => sanitizeImage(`data:image/png;base64,${Buffer.from("not an image").toString("base64")}`, "Logo")).toThrow();
		expect(() => sanitizeImage("https://example.com/logo.png", "Logo")).toThrow();
		expect(() => sanitizeImage(`data:text/html;base64,${Buffer.from("<script>").toString("base64")}`, "Logo")).toThrow();
	});

	it("allows plain SVG but not scripted SVG", () => {
		const svg = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`;
		expect(sanitizeImage(svg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'), "Logo")).not.toBeNull();
		expect(() => sanitizeImage(svg('<svg onload="alert(1)"></svg>'), "Logo")).toThrow();
		expect(() => sanitizeImage(svg("<svg><script>alert(1)</script></svg>"), "Logo")).toThrow();
		expect(() => sanitizeImage(svg('<svg><image href="https://evil.test/x.png"/></svg>'), "Logo")).toThrow();
	});
});

describe("sanitizeCustomCss", () => {
	it("allows ordinary styling", () => {
		const css = ".app-header { backdrop-filter: blur(4px); content: 'a\\201C'; } /* note */ a > b { color: red }";
		expect(sanitizeCustomCss(css)).toBe(css);
	});

	it.each([
		["@import", '@import url("https://evil.test/x.css");'],
		["remote url()", "body { background: url(https://evil.test/a.png) }"],
		["quoted remote url()", 'body { background: url("//evil.test/a.png") }'],
		["@font-face", "@font-face { font-family: x; src: local(y) }"],
		["image-set()", "body { background: image-set('a.png' 1x) }"],
		["javascript:", "a { background: javascript:alert(1) }"],
		["an escaped keyword", "@\\69mport 'x';"],
		["expression()", "a { width: expression(alert(1)) }"],
		["a closing style tag", "</style><script>alert(1)</script>"],
		["-moz-binding", "a { -moz-binding: url(x) }"],
	])("rejects %s", (_name, css) => {
		expect(() => sanitizeCustomCss(css)).toThrow();
	});

	it("allows an embedded raster image in url()", () => {
		expect(() => sanitizeCustomCss(`body { background: url("${png}") }`)).not.toThrow();
	});
});

describe("parseThemeFile", () => {
	const file = () => ({ format: THEME_FILE_FORMAT, version: THEME_FILE_VERSION, theme: { name: "Shared", description: "", config: clone(BUILT_IN_THEMES[1].config) } });

	it("round-trips an exported theme", () => {
		expect(parseThemeFile(file()).config).toEqual(BUILT_IN_THEMES[1].config);
	});

	it("rejects foreign, newer or hostile files", () => {
		expect(() => parseThemeFile({ ...file(), format: "other" })).toThrow();
		expect(() => parseThemeFile({ ...file(), version: 99 })).toThrow();
		const hostile = file();
		hostile.theme.config.customCss = "@import 'https://evil.test/x.css';";
		expect(() => parseThemeFile(hostile)).toThrow();
		expect(() => parseThemeFile("nope")).toThrow();
	});
});

describe("scheduled themes", () => {
	const themeId = "a1f1e000-0000-4000-8000-000000000002";
	const schedule = (start: string, end: string, enabled = true) => sanitizeSchedules([{ name: "Holiday", themeId, start, end, enabled }]);

	it("matches a date range and its edges", () => {
		expect(scheduledThemeId(schedule("10-20", "11-02"), new Date(2026, 9, 31))).toBe(themeId);
		expect(scheduledThemeId(schedule("10-20", "11-02"), new Date(2026, 10, 3))).toBeNull();
	});

	it("wraps over the new year and honours the enabled flag", () => {
		expect(scheduledThemeId(schedule("12-20", "01-05"), new Date(2027, 0, 2))).toBe(themeId);
		expect(scheduledThemeId(schedule("12-20", "01-05"), new Date(2026, 5, 2))).toBeNull();
		expect(scheduledThemeId(schedule("01-01", "12-31", false), new Date(2026, 5, 2))).toBeNull();
	});

	it("rejects impossible dates and bad theme ids", () => {
		expect(() => schedule("13-01", "01-01")).toThrow();
		expect(() => schedule("02-30", "03-01")).toThrow();
		expect(() => sanitizeSchedules([{ name: "x", themeId: "nope", start: "01-01", end: "01-02" }])).toThrow();
	});
});

describe("login background and library accents", () => {
	it("accepts rasters only for the login background", () => {
		expect(sanitizeImage(png, "Background", { rasterOnly: true })).toBe(png);
		const svg = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64")}`;
		expect(() => sanitizeImage(svg, "Background", { rasterOnly: true })).toThrow();
	});

	it("keeps only uuid keys with hex colours", () => {
		const id = "a1f1e000-0000-4000-8000-000000000003";
		expect(sanitizeLibraryAccents({ [id]: "#ABCDEF", junk: "#000000" })).toEqual({ [id]: "#abcdef" });
		expect(() => sanitizeLibraryAccents({ [id]: "red" })).toThrow();
	});
});
