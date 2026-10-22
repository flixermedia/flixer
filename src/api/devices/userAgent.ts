export interface ClientDescription {
	/** Operating system or hardware, e.g. "Windows" or "iPhone". */
	device: string;
	/** Browser or client application, e.g. "Chrome 126". */
	app: string;
}

const DEVICES: Array<[RegExp, string]> = [
	[/iPhone/i, "iPhone"],
	[/iPad/i, "iPad"],
	[/Android/i, "Android"],
	[/Windows/i, "Windows"],
	[/Mac OS X|Macintosh/i, "macOS"],
	[/CrOS/i, "ChromeOS"],
	[/Linux/i, "Linux"],
];

// Order matters: Edge and Opera also contain "Chrome", Chrome also contains "Safari".
const APPS: Array<[RegExp, string]> = [
	[/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
	[/OPR\/(\d+)/, "Opera"],
	[/Firefox\/(\d+)|FxiOS\/(\d+)/, "Firefox"],
	[/Chrome\/(\d+)|CriOS\/(\d+)/, "Chrome"],
	[/Version\/(\d+).*Safari/, "Safari"],
];

/** Derives a readable device and app name from a User-Agent header. */
export function describeClient(userAgent: string | null | undefined): ClientDescription {
	const agent = userAgent?.trim();
	if (!agent) {
		return { device: "Unknown device", app: "Unknown app" };
	}

	const device = DEVICES.find(([pattern]) => pattern.test(agent))?.[1];
	for (const [pattern, name] of APPS) {
		const match = pattern.exec(agent);
		if (match) {
			const version = match.slice(1).find(Boolean);
			return { device: device ?? "Unknown device", app: version ? `${name} ${version}` : name };
		}
	}

	// Non-browser clients (curl, mobile apps) identify themselves as "name/version".
	const product = /^([A-Za-z][\w.-]*)(?:\/([\d.]+))?/.exec(agent);
	return {
		device: device ?? "Unknown device",
		app: product ? [product[1], product[2]?.split(".")[0]].filter(Boolean).join(" ") : "Unknown app",
	};
}
