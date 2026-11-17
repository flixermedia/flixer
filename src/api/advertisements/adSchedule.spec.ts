import { describe, expect, it } from "vitest";
import type { Advertisement } from "../../entities/advertisement.entity.js";
import type { AdvertisementSettings } from "../../entities/advertisementSettings.entity.js";
import { scheduleAdvertisements } from "./adSchedule.js";

const settings = { enabled: true, minimumIntervalSeconds: 300, maxPerPlayback: 3 } as AdvertisementSettings;
const context = { ids: ["episode", "series"], kind: "tv" as const, artists: [] };
function ad(id: string, changes: Partial<Advertisement> = {}): Advertisement {
	return { id, enabled: true, preroll: true, midrollSeconds: [100, 300, 600, 900], scopes: [{ type: "all", ref: null }], ...changes } as Advertisement;
}

describe("advertisement scheduling", () => {
	it("is disabled by default and enforces spacing and per-playback limits", () => {
		expect(scheduleAdvertisements([ad("a")], { ...settings, enabled: false }, context)).toEqual([]);
		expect(scheduleAdvertisements([ad("a")], settings, context).map((entry) => entry.atSeconds)).toEqual([0, 300, 600]);
		expect(scheduleAdvertisements([ad("a")], { ...settings, maxPerPlayback: 0 }, context)).toEqual([]);
	});

	it("matches ancestor scopes and only chooses eligible ads at each position", () => {
		const matching = ad("a", { scopes: [{ type: "item", ref: "series" }], preroll: false, midrollSeconds: [500] });
		const wrong = ad("b", { scopes: [{ type: "kind", ref: "movies" }] });
		const disabled = ad("c", { enabled: false });
		expect(scheduleAdvertisements([wrong, disabled, matching], settings, context)).toEqual([{ atSeconds: 500, ad: matching }]);
	});

	it("rotates eligible ads rather than stacking them at a break", () => {
		expect(scheduleAdvertisements([ad("b"), ad("a")], settings, context).map((entry) => entry.ad.id)).toEqual(["a", "b", "a"]);
	});
});
