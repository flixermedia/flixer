// Runs the converted chat paths (conversations, messages, MLS devices and welcomes) against a migrated throwaway schema:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/chat/chatEntitiesPostgres.spec.ts
import { generateKeyPairSync, randomUUID, sign as signBytes } from "node:crypto";
import { BadRequest, Conflict, Forbidden, NotFound } from "@tsed/exceptions";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import type { NotificationService } from "../api/notifications/notificationService.js";
import { ENTITIES } from "../datasources/entityList.js";
import { MIGRATIONS } from "../datasources/migrationList.js";
import { ChatMember, ChatMessage } from "../entities/chat.entity.js";
import { ChatConversation } from "../entities/chatConversation.entity.js";
import { ChatMlsDevice, ChatMlsHistoryBackup, ChatMlsKeyPackage, ChatMlsWelcome } from "../entities/chatMls.entity.js";
import { IssueReport } from "../entities/issueReport.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { User } from "../entities/user.entity.js";
import type { PartiesService } from "../party/partiesService.js";
import { CallService } from "./callService.js";
import { ChatService } from "./chatService.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("chat entities with PostgreSQL", () => {
	const schema = `chat_entities_test_${randomUUID().replaceAll("-", "")}`;
	const [alex, sam, kim, lee] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
	let admin: DataSource;
	let db: DataSource;
	const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));

	// A fresh service per test keeps the per-user send throttle from leaking between tests.
	const fresh = () => new ChatService(db, { send } as unknown as NotificationService);
	const setSetting = (key: string, value: boolean) => db.getRepository(Setting).update({ key }, { value });
	const messageRows = (conversationId: string) => db.getRepository(ChatMessage).find({ where: { conversationId }, order: { sequence: "ASC" } });

	function device() {

		const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		return { privateKey, pairingPublicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"), id: randomUUID() };

	}

	beforeAll(async () => {
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({ type: "postgres", url: databaseUrl, extra: { options: `-c search_path=${schema}` }, schema, entities: ENTITIES, migrations: MIGRATIONS, synchronize: false });
		await db.initialize();
		await db.runMigrations();
		await db.getRepository(User).save([
			{ id: alex, username: "alex", displayName: "Alex", passwordHash: "unused" },
			{ id: sam, username: "sam", displayName: "Sam", passwordHash: "unused" },
			{ id: kim, username: "kim", passwordHash: "unused" },
			{ id: lee, username: "lee", passwordHash: "unused" },
		]);
		await db.getRepository(Setting).save([
			{ key: "chat_e2ee_enabled", value: false },
			{ key: "chat_user_downgrade_enabled", value: true },
			{ key: "issue_reports_chat_enabled", value: true },
			{ key: "calls_enabled", value: true },
		]);
	});

	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await admin.destroy();
		}
	});

	it("starts one direct conversation per pair and stores both members", async () => {
		const chat = fresh();
		const first = await chat.startDirect(alex, "sam");
		const again = await chat.startDirect(sam, "alex");
		expect(again.id).toBe(first.id);
		expect(first).toMatchObject({ kind: "direct", encryptionMode: "plaintext", name: null, unread: 0 });
		expect(first.members.map((member) => member.username).sort()).toEqual(["alex", "sam"]);
		await expect(chat.startDirect(alex, "alex")).rejects.toBeInstanceOf(BadRequest);

		const row = await db.getRepository(ChatConversation).findOneByOrFail({ id: first.id });
		expect(row).toMatchObject({ kind: "direct", directKey: [alex, sam].sort().join(":"), createdBy: alex, encryptionMode: "plaintext" });
		const members = await db.getRepository(ChatMember).find({ where: { conversationId: first.id } });
		expect(members.map((member) => member.role)).toEqual(["member", "member"]);
		expect(await chat.conversations(alex)).toMatchObject({ conversations: [{ id: first.id }] });
	});

	it("creates groups, sends messages and pages history by sequence", async () => {
		const chat = fresh();
		const group = await chat.createGroup(alex, "  Movie   night ", ["sam", "kim"]);
		expect(group).toMatchObject({ kind: "group", name: "Movie night", encryptionMode: "plaintext" });
		expect(group.members.map((member) => [member.username, member.role])).toEqual([
			["alex", "owner"],
			["sam", "member"],
			["kim", "member"],
		]);

		const first = await chat.send(alex, group.id, "one");
		const second = await chat.send(alex, group.id, "two");
		const third = await chat.send(alex, group.id, "three");
		expect(typeof first.sequence).toBe("string");
		expect(BigInt(second.sequence)).toBeGreaterThan(BigInt(first.sequence));
		expect(first).toMatchObject({ kind: "text", encrypted: false, body: "one", conversationId: group.id, sender: { username: "alex", displayName: "Alex" } });

		// The unread badge counts text messages the member has not fetched yet.
		expect(await chat.unreadCount(sam)).toBe(3);
		expect((await chat.conversations(sam)).conversations[0]).toMatchObject({ id: group.id, unread: 3, lastMessage: { body: "three" } });
		expect(await chat.unreadCount(alex)).toBe(0);

		const all = await chat.messages(sam, group.id, {});
		expect(all.hasMore).toBe(false);
		expect(all.messages.map((message) => message.body)).toEqual(['created the group "Movie night"', "one", "two", "three"]);
		expect(await chat.unreadCount(sam)).toBe(0);

		expect((await chat.messages(sam, group.id, { afterSequence: first.sequence })).messages.map((message) => message.body)).toEqual(["two", "three"]);
		expect((await chat.messages(sam, group.id, { beforeSequence: third.sequence })).messages.map((message) => message.body)).toEqual(['created the group "Movie night"', "one", "two"]);

		// More than one page: the newest 50 come back oldest first, and the cursor reaches the rest.
		await db.getRepository(ChatMessage).insert(Array.from({ length: 60 }, (_, index) => ({ id: randomUUID(), conversationId: group.id, userId: alex, body: `bulk ${index}` })));
		const page = await chat.messages(sam, group.id, {});
		expect(page.messages).toHaveLength(50);
		expect(page.hasMore).toBe(true);
		expect(page.messages.at(-1)?.body).toBe("bulk 59");
		const older = await chat.messages(sam, group.id, { beforeSequence: page.messages[0].sequence });
		expect(older.messages).toHaveLength(14);
		expect(older.hasMore).toBe(false);

		await expect(chat.messages(sam, randomUUID(), {})).rejects.toBeInstanceOf(NotFound);
		await expect(chat.send(alex, group.id, "   ")).rejects.toBeInstanceOf(BadRequest);
		await expect(chat.send(alex, group.id, "x", true, undefined, randomUUID())).rejects.toBeInstanceOf(BadRequest);
	});

	it("renames groups, adds and removes members and transfers ownership", async () => {
		const chat = fresh();
		const group = await chat.createGroup(alex, "Crew", ["sam"]);

		expect(await chat.rename(alex, group.id, "Crew 2")).toMatchObject({ name: "Crew 2" });
		await expect(chat.rename(kim, group.id, "Nope")).rejects.toBeInstanceOf(NotFound);
		expect((await chat.addMembers(alex, group.id, ["kim", "sam"])).members.map((member) => member.username)).toEqual(["alex", "sam", "kim"]);

		await expect(chat.removeMember(sam, group.id, "kim")).rejects.toBeInstanceOf(Forbidden);
		await chat.removeMember(alex, group.id, "kim");
		await chat.removeMember(alex, group.id, "alex");
		const members = await db.getRepository(ChatMember).find({ where: { conversationId: group.id } });
		expect(members).toMatchObject([{ userId: sam, role: "owner" }]);
		expect((await messageRows(group.id)).map((message) => message.body)).toEqual(expect.arrayContaining(["kim was removed", "Alex left"]));

		await chat.markRead(sam, group.id);
		await chat.removeMember(sam, group.id, "sam");
		expect(await db.getRepository(ChatConversation).existsBy({ id: group.id })).toBe(false);
		expect(await db.getRepository(ChatMessage).countBy({ conversationId: group.id })).toBe(0);
	});

	it("unlinks support issues when a conversation is deleted or its last member leaves", async () => {
		const chat = fresh();
		const reports = db.getRepository(IssueReport);
		const deleted = await chat.createSupportGroup(alex, sam, "Issue: Playback");
		const left = await chat.createSupportGroup(alex, alex, "Issue: Subtitles");
		await reports.save([
			{ id: randomUUID(), userId: sam, title: "Stutter", category: "Playback", description: "Stops", conversationId: deleted.id, chatOpen: true },
			{ id: randomUUID(), userId: alex, title: "Subs", category: "Other", description: "Late", conversationId: left.id, chatOpen: true },
		]);
		expect(await chat.conversation(alex, deleted.id)).toMatchObject({ supportChatOpen: true });

		const sent = await chat.send(alex, deleted.id, "Looking into it");
		expect(sent.body).toBe("Looking into it");
		expect((await reports.findOneByOrFail({ conversationId: deleted.id })).updatedAt).toBeInstanceOf(Date);

		await chat.deleteConversation(sam, deleted.id);
		expect(await db.getRepository(ChatConversation).existsBy({ id: deleted.id })).toBe(false);
		expect(await reports.findOneByOrFail({ title: "Stutter" })).toMatchObject({ conversationId: null, chatOpen: false });

		await chat.removeMember(alex, left.id, "alex");
		expect(await db.getRepository(ChatConversation).existsBy({ id: left.id })).toBe(false);
		expect(await reports.findOneByOrFail({ title: "Subs" })).toMatchObject({ conversationId: null, chatOpen: false });
	});

	it("switches a conversation between plaintext and encrypted with a system notice", async () => {
		const chat = fresh();
		const direct = await chat.startDirect(sam, "kim");

		expect(await chat.upgradeToEncrypted(sam, direct.id)).toMatchObject({ encryptionMode: "encrypted" });
		expect(await chat.upgradeToEncrypted(sam, direct.id)).toMatchObject({ encryptionMode: "encrypted" });
		expect(await chat.downgradeToPlaintext(kim, direct.id)).toMatchObject({ encryptionMode: "plaintext" });
		const notices = (await messageRows(direct.id)).filter((message) => message.kind === "system");
		expect(notices.map((message) => [message.userId, message.encrypted])).toEqual([
			[sam, false],
			[kim, false],
		]);
		await expect(chat.downgradeToPlaintext(alex, direct.id)).rejects.toBeInstanceOf(NotFound);

		await setSetting("chat_user_downgrade_enabled", false);
		await chat.upgradeToEncrypted(sam, direct.id);
		await expect(chat.downgradeToPlaintext(sam, direct.id)).rejects.toBeInstanceOf(Forbidden);
		await setSetting("chat_user_downgrade_enabled", true);
	});

	it("registers, lists, approves and revokes MLS devices and stores history backups", async () => {
		const chat = fresh();
		const trusted = device();
		const registered = await chat.registerMlsDevice(alex, trusted.id, "  Laptop  ", "AAAA", trusted.pairingPublicKey);
		expect(registered).toMatchObject({ deviceId: trusted.id, status: "active", approvalChallenge: null });
		// Registering again reuses the same device and its identical key package.
		expect((await chat.registerMlsDevice(alex, trusted.id, "Laptop", "AAAA", trusted.pairingPublicKey)).keyPackageId).toBe(registered.keyPackageId);
		await expect(chat.registerMlsDevice(sam, trusted.id, "Stolen", "AAAA", trusted.pairingPublicKey)).rejects.toBeInstanceOf(Conflict);
		await expect(chat.registerMlsDevice(alex, trusted.id, "Laptop", "AAAA", device().pairingPublicKey)).rejects.toBeInstanceOf(Conflict);

		const added = await chat.addMlsKeyPackage(alex, trusted.id, "BBBB");
		expect((await chat.addMlsKeyPackage(alex, trusted.id, "BBBB")).keyPackageId).toBe(added.keyPackageId);
		await expect(chat.addMlsKeyPackage(sam, trusted.id, "CCCC")).rejects.toBeInstanceOf(NotFound);
		expect(await chat.deviceMlsKeyPackages(alex, trusted.id)).toEqual([
			{ keyPackageId: registered.keyPackageId, keyPackage: "AAAA", available: true },
			{ keyPackageId: added.keyPackageId, keyPackage: "BBBB", available: true },
		]);
		await expect(chat.deviceMlsKeyPackages(sam, trusted.id)).rejects.toBeInstanceOf(NotFound);

		const listed = await chat.listMlsDevices(alex);
		expect(listed).toEqual([{ deviceId: trusted.id, name: "Laptop", status: "active", createdAt: expect.any(String), approvedAt: expect.any(String), approvalChallenge: null }]);

		// A pending device is approved only by a signature from an active device of the same account.
		const pending = device();
		const challenge = "approval-challenge";
		await db.getRepository(ChatMlsDevice).insert({ id: pending.id, userId: alex, name: "Phone", status: "pending", pairingPublicKey: pending.pairingPublicKey, approvalChallenge: challenge });
		const payload = Buffer.from(`flixer-chat-device-approval:v1:${pending.id}:${challenge}`);
		const sign = (key: typeof trusted.privateKey) => signBytes("sha256", payload, { key, dsaEncoding: "ieee-p1363" }).toString("base64");
		await expect(chat.approveMlsDevice(alex, trusted.id, pending.id, sign(pending.privateKey))).rejects.toBeInstanceOf(Forbidden);
		await expect(chat.approveMlsDevice(sam, trusted.id, pending.id, sign(trusted.privateKey))).rejects.toBeInstanceOf(NotFound);
		expect(await db.getRepository(ChatMlsDevice).findOneByOrFail({ id: pending.id })).toMatchObject({ status: "pending", approvalChallenge: challenge, approvedAt: null });
		await chat.approveMlsDevice(alex, trusted.id, pending.id, sign(trusted.privateKey));
		const approved = await db.getRepository(ChatMlsDevice).findOneByOrFail({ id: pending.id });
		expect(approved).toMatchObject({ status: "active", approvalChallenge: null });
		expect(approved.approvedAt).toBeInstanceOf(Date);

		// Revoking marks the device and burns its key packages; repeating it changes nothing.
		await chat.revokeMlsDevice(alex, trusted.id);
		await chat.revokeMlsDevice(alex, trusted.id);
		expect(await db.getRepository(ChatMlsDevice).findOneByOrFail({ id: trusted.id })).toMatchObject({ status: "revoked" });
		expect((await db.getRepository(ChatMlsDevice).findOneByOrFail({ id: trusted.id })).revokedAt).toBeInstanceOf(Date);
		const burned = await db.getRepository(ChatMlsKeyPackage).find({ where: { deviceId: trusted.id } });
		expect(burned.every((row) => row.usedAt instanceof Date)).toBe(true);
		await expect(chat.registerMlsDevice(alex, trusted.id, "Laptop", "AAAA", trusted.pairingPublicKey)).rejects.toBeInstanceOf(Conflict);

		expect(await chat.chatHistoryBackup(alex)).toBeNull();
		await chat.saveChatHistoryBackup(alex, "first");
		await chat.saveChatHistoryBackup(alex, "second");
		expect(await chat.chatHistoryBackup(alex)).toBe("second");
		expect(await db.getRepository(ChatMlsHistoryBackup).count({ where: { userId: alex } })).toBe(1);
		await expect(chat.saveChatHistoryBackup(alex, "")).rejects.toBeInstanceOf(BadRequest);
	});

	it("claims key packages and delivers an encrypted message with its Welcome", async () => {
		await setSetting("chat_e2ee_enabled", true);
		try {
			const chat = fresh();
			const leeDevice = device();
			const samDevice = device();
			const leeRegistration = await chat.registerMlsDevice(lee, leeDevice.id, "Lee phone", "AAAA", leeDevice.pairingPublicKey);
			const samRegistration = await chat.registerMlsDevice(sam, samDevice.id, "Sam phone", "BBBB", samDevice.pairingPublicKey);
			const direct = await chat.startDirect(lee, "sam");
			expect(direct.encryptionMode).toBe("encrypted");
			expect(await chat.conversationMlsKeyPackages(lee, direct.id)).toEqual(
				[
					{ userId: lee, deviceId: leeDevice.id, keyPackageId: leeRegistration.keyPackageId, keyPackage: "AAAA", available: true },
					{ userId: sam, deviceId: samDevice.id, keyPackageId: samRegistration.keyPackageId, keyPackage: "BBBB", available: true },
				].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
			);

			await expect(chat.send(lee, direct.id, "hello")).rejects.toBeInstanceOf(BadRequest);
			// Without a Welcome for the other device the encrypted message is rejected and rolled back.
			await expect(chat.send(lee, direct.id, "AAAA", true, undefined, leeDevice.id)).rejects.toBeInstanceOf(Conflict);
			expect(await messageRows(direct.id)).toEqual([]);
			await expect(chat.send(lee, direct.id, "AAAA", true, undefined, samDevice.id)).rejects.toBeInstanceOf(Forbidden);

			// The claim marks the package used; the raw UPDATE ... RETURNING result shape is not asserted here.
			await chat.claimMlsKeyPackage(lee, direct.id, samRegistration.keyPackageId);
			expect((await db.getRepository(ChatMlsKeyPackage).findOneByOrFail({ id: samRegistration.keyPackageId })).usedAt).toBeInstanceOf(Date);
			await expect(chat.claimMlsKeyPackage(alex, direct.id, leeRegistration.keyPackageId)).rejects.toBeInstanceOf(NotFound);

			const welcome = { recipients: [{ deviceId: samDevice.id, keyPackageId: samRegistration.keyPackageId }], welcome: "WWWW", ratchetTree: "TTTT" };
			const message = await chat.send(lee, direct.id, "AAAA", true, welcome, leeDevice.id);
			expect(message).toMatchObject({ encrypted: true, body: "AAAA", kind: "text" });
			expect(await db.getRepository(ChatMlsWelcome).find({ where: { conversationId: direct.id } })).toMatchObject([{ deviceId: samDevice.id, keyPackageId: samRegistration.keyPackageId, messageId: message.id, welcome: "WWWW", ratchetTree: "TTTT", consumedAt: null }]);

			const pending = await chat.pendingMlsWelcomes(sam, direct.id, samDevice.id);
			expect(pending).toMatchObject([{ messageId: message.id, keyPackageId: samRegistration.keyPackageId, welcome: "WWWW", ratchetTree: "TTTT" }]);
			await expect(chat.pendingMlsWelcomes(sam, direct.id, leeDevice.id)).rejects.toBeInstanceOf(NotFound);
			await chat.acknowledgeMlsWelcome(sam, direct.id, samDevice.id, pending[0].id);
			expect(await chat.pendingMlsWelcomes(sam, direct.id, samDevice.id)).toEqual([]);

			// Storing the identical Welcome again is idempotent; a different one conflicts.
			await chat.storeMlsWelcome(lee, direct.id, message.id, welcome.recipients, "WWWW", "TTTT");
			await expect(chat.storeMlsWelcome(lee, direct.id, message.id, welcome.recipients, "XXXX", "TTTT")).rejects.toBeInstanceOf(Conflict);
			await expect(chat.storeMlsWelcome(lee, direct.id, randomUUID(), welcome.recipients, "WWWW", "TTTT")).rejects.toBeInstanceOf(NotFound);
			await expect(chat.storeMlsWelcome(lee, direct.id, message.id, [{ deviceId: samDevice.id, keyPackageId: randomUUID() }], "WWWW", "TTTT")).rejects.toBeInstanceOf(BadRequest);
		} finally {
			await setSetting("chat_e2ee_enabled", false);
		}
	});

	it("lists the other members of a conversation for calls", async () => {
		const chat = fresh();
		const group = await chat.createGroup(alex, "Call night", ["sam", "kim"]);
		const calls = new CallService(db, {} as PartiesService);

		expect((await calls.recipients(alex, group.id)).sort()).toEqual([sam, kim].sort());
		await db.getRepository(ChatMember).delete({ conversationId: group.id, userId: kim });
		await expect(calls.recipients(kim, group.id)).rejects.toBeInstanceOf(NotFound);
		expect(await calls.recipients(sam, group.id)).toEqual([alex]);
	});
});
