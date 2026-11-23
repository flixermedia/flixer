import { describe, expect, it, vi } from "vitest";
import { AddInviteDisablePlexOnlineSources1798300000039 } from "./addInviteDisablePlexOnlineSources1798300000039.js";

describe("AddInviteDisablePlexOnlineSources1798300000039", () => {
	it("adds disable_plex_online_sources idempotently", async () => {
		const query = vi.fn();
		await new AddInviteDisablePlexOnlineSources1798300000039().up({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('ADD COLUMN IF NOT EXISTS "disable_plex_online_sources" boolean NOT NULL DEFAULT false');
	});

	it("drops disable_plex_online_sources on rollback", async () => {
		const query = vi.fn();
		await new AddInviteDisablePlexOnlineSources1798300000039().down({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('DROP COLUMN IF EXISTS "disable_plex_online_sources"');
	});
});
