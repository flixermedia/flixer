import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { describe, expect, it } from "vitest";
import partyJsonScript from "./lua/partyJson.lua?raw";
import presenceScript from "./lua/presence.lua?raw";
import controlScript from "./lua/control.lua?raw";
import endScript from "./lua/end.lua?raw";

const redisUrl = process.env.PARTY_TEST_REDIS_URL;

describe.skipIf(!redisUrl)("party Lua scripts with Redis", () => {
	it("preserves member arrays in storage, responses and published state", async () => {
		const client = createClient({ url: redisUrl });
		const subscriber = client.duplicate();
		const prefix = `flixer:test:party:${randomUUID()}`;
		const [state, presence, people, channel, rate, host, username, active] =
			["state", "presence", "people", "events", "rate", "host", "username", "active"].map((suffix) => `${prefix}:${suffix}`);
		const person = { id: "host", username: "host", displayName: "Host", avatarUrl: null };
		const party = {
			id: "test", host: person, members: [person], item: { id: "movie", type: "movie" },
			kind: "video", playing: false, position: 0, at: 0, version: 0, playbackRate: 1,
		};
		const events: Array<{ message: { party: { members: unknown } } }> = [];
		try {
			await client.connect();
			await subscriber.connect();
			await subscriber.subscribe(channel, (message) => events.push(JSON.parse(message)));
			await client.set(state, JSON.stringify(party));

			async function updatePresence(action: string) {
				const result = await client.eval(`${partyJsonScript}\n${presenceScript}`, {
					keys: [state, presence, people, channel],
					arguments: [action === "sweep" ? "renew" : action, action === "sweep" ? "" : "connection", "host", "75000", "50", JSON.stringify(person), action, "86400"],
				});
				return JSON.parse(String(result)) as { party: { members: unknown } };
			}

			expect((await updatePresence("sweep")).party.members).toEqual([]);
			expect(JSON.parse((await client.get(state))!).members).toEqual([]);
			expect((await updatePresence("join")).party.members).toEqual([person]);
			expect((await updatePresence("leave")).party.members).toEqual([]);
			expect(JSON.parse((await client.get(state))!).members).toEqual([]);

			await client.set(state, JSON.stringify({ ...party, members: {} }));
			const controlArgs = ["host", JSON.stringify({ action: "play", commandId: "test" }), "300", "", "86400", "86400"];
			const runControl = () => client.eval(`${partyJsonScript}\n${controlScript}`, {
				keys: [state, rate, channel], arguments: controlArgs,
			});
			expect(JSON.parse(String(await runControl())).party.members).toEqual([]);
			expect(JSON.parse((await client.get(state))!).members).toEqual([]);
			expect(JSON.parse(String(await runControl())).party.members).toEqual([]);

			const end = await client.eval(`${partyJsonScript}\n${endScript}`, {
				keys: [state, host, username, active, presence, people, channel], arguments: ["host", "host-ended"],
			});
			expect(JSON.parse(String(end)).party.members).toEqual([]);
			await viWaitForEvents();
			expect(events.map((event) => event.message.party.members)).toEqual([[], [person], [], []]);
		} finally {
			if (client.isOpen) {
				await client.del([state, presence, people, rate, host, username, active]);
				await client.quit();
			}
			if (subscriber.isOpen) await subscriber.quit();
		}

		async function viWaitForEvents() {
			await expect.poll(() => events.filter((event) => event.message.party).length).toBe(4);
			events.splice(0, events.length, ...events.filter((event) => event.message.party));
		}
	});
});
