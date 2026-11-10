import type { ThemeConfig, ThemePalette } from "./themeSchema.js";

export interface BuiltInTheme {
	id: string;
	name: string;
	description: string;
	config: ThemeConfig;
}

export const DEFAULT_THEME_ID = "a1f1e000-0000-4000-8000-000000000001";

const noBranding = { appName: null, logo: null, logoLight: null, favicon: null, loginBackground: null };

function palette(values: Omit<ThemePalette, "ink"> & { ink: string }): ThemePalette {
	return values;
}

/** The look Flixer has always had; its dark and light palettes mirror the original stylesheet. */
const flixerDefault: ThemeConfig = {
	defaultMode: "dark",
	colors: {
		dark: palette({ background: "#080811", surface: "#14131d", border: "#292735", primary: "#7645d7", secondary: "#5366e7", accent: "#a789ff", highlight: "#4bd9e8", text: "#f4f2fb", muted: "#9492a4", ink: "#ffffff" }),
		light: palette({ background: "#f5f4fa", surface: "#ffffff", border: "#dcd9e8", primary: "#6a3bc9", secondary: "#4b5ed6", accent: "#6d3fd0", highlight: "#0e8fa0", text: "#1c1b29", muted: "#5f5d72", ink: "#14131d" }),
	},
	shape: { radius: 0.25 },
	typography: { font: "system" },
	layout: { contentWidth: "standard", density: "comfortable", cardStyle: "elevated", buttonStyle: "solid", artworkAccent: false },
	header: { style: "floating", height: "standard", navAlign: "center", showName: true },
	branding: noBranding,
	customCss: "",
};

const midnightOcean: ThemeConfig = {
	defaultMode: "dark",
	colors: {
		dark: palette({ background: "#07111f", surface: "#0e1b2e", border: "#1f3350", primary: "#1a78d0", secondary: "#0b8f9e", accent: "#5cc8ff", highlight: "#6ee7b7", text: "#eaf4ff", muted: "#8aa2bd", ink: "#ffffff" }),
		light: palette({ background: "#eef5fb", surface: "#ffffff", border: "#cfdeec", primary: "#0b6fc2", secondary: "#00798a", accent: "#0b74c9", highlight: "#0f766e", text: "#0e1b2e", muted: "#51667d", ink: "#0e1b2e" }),
	},
	shape: { radius: 0.5 },
	typography: { font: "humanist" },
	layout: { contentWidth: "wide", density: "comfortable", cardStyle: "outlined", buttonStyle: "solid", artworkAccent: false },
	header: { style: "bar", height: "standard", navAlign: "start", showName: true },
	branding: noBranding,
	customCss: "",
};

const emberGlow: ThemeConfig = {
	defaultMode: "dark",
	colors: {
		dark: palette({ background: "#130a0a", surface: "#201213", border: "#3d2425", primary: "#d83f45", secondary: "#d9731a", accent: "#ff8a7a", highlight: "#ffc857", text: "#fbeeea", muted: "#a99290", ink: "#ffffff" }),
		light: palette({ background: "#fbf3f0", surface: "#ffffff", border: "#ead7d1", primary: "#c0343a", secondary: "#b85d0a", accent: "#c2362f", highlight: "#8f5d00", text: "#2a1514", muted: "#735d5a", ink: "#2a1514" }),
	},
	shape: { radius: 0.75 },
	typography: { font: "geometric" },
	layout: { contentWidth: "standard", density: "comfortable", cardStyle: "glass", buttonStyle: "gradient", artworkAccent: false },
	header: { style: "transparent", height: "tall", navAlign: "center", showName: true },
	branding: noBranding,
	customCss: "",
};

const forestCanopy: ThemeConfig = {
	defaultMode: "auto",
	colors: {
		dark: palette({ background: "#0a110d", surface: "#121b16", border: "#243329", primary: "#2a8f61", secondary: "#5d9a3a", accent: "#7ee0a6", highlight: "#e3c76b", text: "#ecf6ef", muted: "#8ea296", ink: "#ffffff" }),
		light: palette({ background: "#f1f6f2", surface: "#ffffff", border: "#d3e0d6", primary: "#1f7a52", secondary: "#467f26", accent: "#1f7a4f", highlight: "#7c6208", text: "#14231a", muted: "#567060", ink: "#14231a" }),
	},
	shape: { radius: 1 },
	typography: { font: "rounded" },
	layout: { contentWidth: "standard", density: "spacious", cardStyle: "elevated", buttonStyle: "solid", artworkAccent: false },
	header: { style: "floating", height: "standard", navAlign: "center", showName: true },
	branding: noBranding,
	customCss: "",
};

const noirTerminal: ThemeConfig = {
	defaultMode: "dark",
	colors: {
		dark: palette({ background: "#0b0b0b", surface: "#151515", border: "#2c2c2c", primary: "#9a6412", secondary: "#52525b", accent: "#f5b83d", highlight: "#e5e5e5", text: "#f2f2f2", muted: "#9a9a9a", ink: "#ffffff" }),
		light: palette({ background: "#f4f4f2", surface: "#ffffff", border: "#d6d6d2", primary: "#8a5a0f", secondary: "#4b4b52", accent: "#8a5a0f", highlight: "#3f3f46", text: "#171717", muted: "#62625c", ink: "#171717" }),
	},
	shape: { radius: 0 },
	typography: { font: "mono" },
	layout: { contentWidth: "full", density: "compact", cardStyle: "flat", buttonStyle: "soft", artworkAccent: false },
	header: { style: "minimal", height: "compact", navAlign: "start", showName: true },
	branding: noBranding,
	customCss: "",
};

export const BUILT_IN_THEMES: readonly BuiltInTheme[] = [
	{ id: DEFAULT_THEME_ID, name: "Flixer Default", description: "The original Flixer look, with its purple dark and light modes.", config: flixerDefault },
	{ id: "a1f1e000-0000-4000-8000-000000000002", name: "Midnight Ocean", description: "Deep blues and teal with a crisp full-width header.", config: midnightOcean },
	{ id: "a1f1e000-0000-4000-8000-000000000003", name: "Ember Glow", description: "Warm reds and amber, glassy cards and a see-through header.", config: emberGlow },
	{ id: "a1f1e000-0000-4000-8000-000000000004", name: "Forest Canopy", description: "Calm greens with soft, generously rounded corners.", config: forestCanopy },
	{ id: "a1f1e000-0000-4000-8000-000000000005", name: "Noir Terminal", description: "Sharp corners, monospace type and amber on near-black.", config: noirTerminal },
];

export const BUILT_IN_THEME_IDS: ReadonlySet<string> = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
