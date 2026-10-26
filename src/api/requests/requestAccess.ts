import type { RequestUserLimit } from "../../entities/requestUserLimit.entity.js";
import type { RequestSettings } from "./requestSettings.js";

export interface RequestAccess {
	canRequest: boolean;
	autoApprove: boolean;
	/** null means unlimited. */
	quotaLimit: number | null;
	quotaDays: number;
}

/** What one user may do: administrators are unrestricted, everyone else follows the global defaults unless overridden. */
export function resolveAccess(
	isAdmin: boolean,
	settings: RequestSettings,
	limit: RequestUserLimit | null | undefined,
): RequestAccess {

	if (isAdmin) {
		return { canRequest: true, autoApprove: true, quotaLimit: null, quotaDays: settings.quotaDays };
	}
	const quota = limit?.quotaLimit ?? settings.quotaLimit;
	return {
		canRequest: limit?.canRequest ?? settings.defaultCanRequest,
		autoApprove: limit?.autoApprove ?? settings.autoApprove,
		quotaLimit: quota > 0 ? quota : null,
		quotaDays: limit?.quotaDays ?? settings.quotaDays,
	};

}

/** The TV seasons left to request once the already requested ones are removed; null requests every season. */
export function remainingSeasons(requested: number[] | null, taken: Array<number[] | null>, all: number[]): number[] {

	const covered = new Set<number>();
	for (const seasons of taken) {
		for (const season of seasons ?? all) {
			covered.add(season);
		}
	}
	return (requested ?? all).filter((season) => !covered.has(season));

}
