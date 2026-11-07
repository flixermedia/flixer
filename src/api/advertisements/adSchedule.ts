import type { Advertisement } from "../../entities/advertisement.entity.js";
import type { AdvertisementSettings } from "../../entities/advertisementSettings.entity.js";
import { anyScopeCovers, type ItemContext } from "../payments/paymentTypes.js";

export interface ScheduledAdvertisement {
	atSeconds: number;
	ad: Advertisement;
}

/** Selects at most one ad per break and applies the configured per-playback limits. */
export function scheduleAdvertisements(ads: Advertisement[], settings: AdvertisementSettings, context: ItemContext): ScheduledAdvertisement[] {
	if (!settings.enabled || settings.maxPerPlayback <= 0) return [];
	const eligible = ads.filter((ad) => ad.enabled && anyScopeCovers(ad.scopes, context)).sort((a, b) => a.id.localeCompare(b.id));
	const byPosition = new Map<number, Advertisement[]>();
	for (const ad of eligible) {
		for (const position of [...(ad.preroll ? [0] : []), ...ad.midrollSeconds]) {
			const list = byPosition.get(position) ?? [];
			list.push(ad);
			byPosition.set(position, list);
		}
	}
	const result: ScheduledAdvertisement[] = [];
	for (const [atSeconds, choices] of [...byPosition].sort(([a], [b]) => a - b)) {
		if (result.length >= settings.maxPerPlayback) break;
		const previous = result.at(-1);
		if (previous && atSeconds - previous.atSeconds < settings.minimumIntervalSeconds) continue;
		result.push({ atSeconds, ad: choices[result.length % choices.length] });
	}
	return result;
}
