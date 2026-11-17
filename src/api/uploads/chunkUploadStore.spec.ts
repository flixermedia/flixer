import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkUploadStore } from "./chunkUploadStore.js";

const directories: string[] = [];

async function setup() {
	const root = await mkdtemp(join(tmpdir(), "flixer-upload-test-"));
	directories.push(root);
	return new ChunkUploadStore(root, 10, 4, 60_000);
}

afterEach(async () => {
	vi.useRealTimers();
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("ChunkUploadStore", () => {
	it("assembles out-of-order concurrent chunks with a short final chunk", async () => {
		const store = await setup();
		const upload = await store.create("admin", 10);
		await Promise.all([store.put(upload.id, "admin", 2, Buffer.from("ij")), store.put(upload.id, "admin", 0, Buffer.from("abcd")), store.put(upload.id, "admin", 1, Buffer.from("efgh"))]);
		const path = await store.assemble(upload.id, "admin");
		expect((await readFile(path)).toString()).toBe("abcdefghij");
		expect(await store.assemble(upload.id, "admin")).toBe(path);
	});

	it("enforces the exact file limit and declared chunk lengths", async () => {
		const store = await setup();
		await expect(store.create("admin", 11)).rejects.toThrow("Invalid upload size");
		await expect(store.create("admin", 0)).rejects.toThrow("Invalid upload size");
		const upload = await store.create("admin", 10);
		await expect(store.put(upload.id, "admin", 0, Buffer.from("abc"))).rejects.toThrow("Invalid chunk size");
		await expect(store.put(upload.id, "admin", 2, Buffer.from("abc"))).rejects.toThrow("Invalid chunk size");
		await expect(store.put(upload.id, "admin", -1, Buffer.from("abcd"))).rejects.toThrow("Invalid chunk index");
		await expect(store.put(upload.id, "admin", 3, Buffer.from("abcd"))).rejects.toThrow("Invalid chunk index");
	});

	it("admits exactly 100 MiB but not one byte more when used for ads", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-upload-test-"));
		directories.push(root);
		const maxBytes = 100 * 1024 * 1024;
		const store = new ChunkUploadStore(root, maxBytes, 5 * 1024 * 1024, 60_000);
		expect((await store.create("admin", maxBytes)).size).toBe(maxBytes);
		await expect(store.create("admin", maxBytes + 1)).rejects.toThrow("Invalid upload size");
	});

	it("accepts identical retries but rejects conflicting content", async () => {
		const store = await setup();
		const upload = await store.create("admin", 4);
		await Promise.all(Array.from({ length: 3 }, () => store.put(upload.id, "admin", 0, Buffer.from("abcd"))));
		await expect(store.put(upload.id, "admin", 0, Buffer.from("wxyz"))).rejects.toThrow("different content");
		expect((await readFile(await store.assemble(upload.id, "admin"))).toString()).toBe("abcd");
	});

	it("does not assemble incomplete uploads and permits later retry", async () => {
		const store = await setup();
		const upload = await store.create("admin", 6);
		await store.put(upload.id, "admin", 0, Buffer.from("abcd"));
		await expect(store.assemble(upload.id, "admin")).rejects.toThrow("missing chunks");
		await store.put(upload.id, "admin", 1, Buffer.from("ef"));
		expect((await readFile(await store.assemble(upload.id, "admin"))).toString()).toBe("abcdef");
	});

	it("isolates sessions by owner and rejects path traversal", async () => {
		const store = await setup();
		const upload = await store.create("admin", 4);
		await expect(store.put(upload.id, "other", 0, Buffer.from("abcd"))).rejects.toThrow("Upload not found");
		await expect(store.remove(upload.id, "other")).rejects.toThrow("Upload not found");
		await expect(store.assemble("../other", "admin")).rejects.toThrow("Upload not found");
		await store.remove(upload.id, "admin");
		await expect(store.assemble(upload.id, "admin")).rejects.toThrow("Upload not found");
	});

	it("rejects expired sessions while still allowing their owner to remove them", async () => {
		vi.useFakeTimers();
		const store = await setup();
		const upload = await store.create("admin", 4);
		vi.advanceTimersByTime(60_000);
		await expect(store.put(upload.id, "admin", 0, Buffer.from("abcd"))).rejects.toThrow("expired");
		await expect(store.assemble(upload.id, "admin")).rejects.toThrow("expired");
		await store.remove(upload.id, "admin");
		await expect(store.assemble(upload.id, "admin")).rejects.toThrow("Upload not found");
	});

	it("removes abandoned expired sessions when creating a new upload", async () => {
		vi.useFakeTimers();
		const store = await setup();
		const expired = await store.create("admin", 4);
		vi.advanceTimersByTime(60_000);
		const current = await store.create("admin", 4);
		await expect(store.assemble(expired.id, "admin")).rejects.toThrow("Upload not found");
		await store.put(current.id, "admin", 0, Buffer.from("abcd"));
		expect((await readFile(await store.assemble(current.id, "admin"))).toString()).toBe("abcd");
	});
});
