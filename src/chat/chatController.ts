import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../api/auth/authService.js";
import { CallService } from "./callService.js";
import { ChatService } from "./chatService.js";
import { AddChatMlsKeyPackageRequest, AcknowledgeChatMlsWelcomeRequest, ApproveChatMlsDeviceRequest, ChatMlsHistoryBackupRequest, AddMembersRequest, RegisterChatMlsDeviceRequest, RenameChatRequest, SendMessageRequest, StartChatRequest, StoreChatMlsWelcomeRequest } from "./chatRequests.js";

const conversationId = (value: string): string => {
	if (!AuthService.isUuid(value)) {
		throw new NotFound("Conversation not found.");
	}
	return value.toLowerCase();
};

/** Direct messages and group chats. New messages also land in the notification inbox. */
@Controller("/chat")
@Security("BearerAuth")
export class ChatController {

	constructor(
		private readonly authService: AuthService,
		private readonly chat: ChatService,
		private readonly calls: CallService,
	) {}

	@Get("/conversations")
	async list(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.conversations(user.id);
	}

	/** STUN/TURN servers for peer-to-peer calls, with short-lived TURN credentials. */
	@Get("/calls/ice")
	async callIce(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.calls.iceConfig(user.id);
	}

	@Post("/calls/signal")
	async sendCallSignal(
		@BodyParams() body: { conversationId?: string; callId?: string; to?: string; payload?: string },
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
		const callId = typeof body?.callId === "string" ? body.callId : "";
		const payload = typeof body?.payload === "string" ? body.payload : "";
		const to = typeof body?.to === "string" ? body.to : undefined;
		if (!AuthService.isUuid(conversationId) || !/^[\w-]{1,64}$/.test(callId) || payload.length === 0 || payload.length > 200_000) {
			throw new BadRequest("Invalid call signal.");
		}
		const recipients = await this.calls.recipients(user.id, conversationId.toLowerCase());
		const targets = to === undefined ? recipients : recipients.filter((id) => id === to);
		this.calls.enqueueSignal(targets, {
			type: "call-signal",
			conversationId: conversationId.toLowerCase(),
			callId,
			from: user.id,
			payload,
		});
		return { queued: targets.length };
	}

	@Get("/calls/signals")
	async pollCallSignals(@QueryParams("after") afterRaw?: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const parsed = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
		const after = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
		return this.calls.readSignals(user.id, after);
	}

	@Post("/calls/log")
	async logCall(
		@BodyParams() body: { conversationId?: string; callId?: string; video?: boolean; outcome?: string; durationSeconds?: number },
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const id = typeof body?.conversationId === "string" ? body.conversationId : "";
		const callId = typeof body?.callId === "string" ? body.callId : "";
		const outcome = body?.outcome;
		if (!AuthService.isUuid(id) || !/^[\w-]{1,64}$/.test(callId) || (outcome !== "ended" && outcome !== "declined" && outcome !== "missed" && outcome !== "failed")) {
			throw new BadRequest("Invalid call log.");
		}
		return this.chat.logCall(user.id, id.toLowerCase(), {
			callId,
			video: body?.video === true,
			outcome,
			durationSeconds: typeof body?.durationSeconds === "number" ? body.durationSeconds : undefined,
		});
	}

	@Get("/unread")
	async unread(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { count: await this.chat.unreadCount(user.id) };
	}

	@Get("/presence")
	async presence(@HeaderParams("authorization") authorization?: string) {
		await this.authService.getAuthenticatedUser(authorization);
		return { presence: this.chat.getPresenceSnapshot() };
	}

	@Post("/presence")
	async updatePresence(@BodyParams() body: { active?: boolean; offline?: boolean }, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const username = user.username ?? (await this.chat.usernameForUser(user.id));
		if (username) {
			const status = body?.offline ? "offline" : body?.active === false ? "away" : "online";
			this.chat.setPresence(username, status, false);
		}
		return { presence: this.chat.getPresenceSnapshot() };
	}

	@Get("/encryption/status")
	async encryptionStatus(@HeaderParams("authorization") authorization?: string) {
		await this.authService.getAuthenticatedUser(authorization);
		return this.chat.encryptionStatus();
	}

	@Post("/devices")
	@Returns(201)
	async registerMlsDevice(@BodyParams() request: RegisterChatMlsDeviceRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(request.deviceId)) throw new BadRequest("The chat device ID is invalid.");
		return this.chat.registerMlsDevice(user.id, request.deviceId.toLowerCase(), request.name, request.keyPackage, request.pairingPublicKey);
	}

	@Get("/devices")
	async mlsDevices(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { devices: await this.chat.listMlsDevices(user.id) };
	}

	@Get("/history-backup")
	async chatHistoryBackup(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { backup: await this.chat.chatHistoryBackup(user.id) };
	}

	@Put("/history-backup")
	async saveChatHistoryBackup(@BodyParams() request: ChatMlsHistoryBackupRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.chat.saveChatHistoryBackup(user.id, request.backup);
		return { saved: true };
	}

	@Post("/devices/:deviceId/approve")
	@Returns(204)
	async approveMlsDevice(@PathParams("deviceId") deviceId: string, @BodyParams() request: ApproveChatMlsDeviceRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(deviceId) || !AuthService.isUuid(request.approverDeviceId)) {
			throw new BadRequest("The chat device ID is invalid.");
		}
		await this.chat.approveMlsDevice(user.id, request.approverDeviceId.toLowerCase(), deviceId.toLowerCase(), request.signature);
	}

	@Delete("/devices/:deviceId")
	@Returns(204)
	async revokeMlsDevice(@PathParams("deviceId") deviceId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(deviceId)) throw new BadRequest("The chat device ID is invalid.");
		await this.chat.revokeMlsDevice(user.id, deviceId.toLowerCase());
	}

	@Post("/devices/:deviceId/key-packages")
	@Returns(201)
	async addMlsKeyPackage(@PathParams("deviceId") deviceId: string, @BodyParams() request: AddChatMlsKeyPackageRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(deviceId)) throw new BadRequest("The chat device ID is invalid.");
		return this.chat.addMlsKeyPackage(user.id, deviceId.toLowerCase(), request.keyPackage);
	}

	@Get("/devices/:deviceId/key-packages")
	async deviceMlsKeyPackages(@PathParams("deviceId") deviceId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(deviceId)) throw new BadRequest("The chat device ID is invalid.");
		return { keyPackages: await this.chat.deviceMlsKeyPackages(user.id, deviceId.toLowerCase()) };
	}

	@Post("/conversations")
	@Returns(201)
	async start(@BodyParams() request: StartChatRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (request.username) {
			return this.chat.startDirect(user.id, request.username);
		}
		if (request.usernames) {
			return this.chat.createGroup(user.id, request.name, request.usernames);
		}
		throw new BadRequest("Pick someone to message.");
	}

	@Get("/conversations/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.conversation(user.id, conversationId(id));
	}

	@Post("/conversations/:id/downgrade")
	async downgradeToPlaintext(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.downgradeToPlaintext(user.id, conversationId(id));
	}

	@Post("/conversations/:id/upgrade")
	async upgradeToEncrypted(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.upgradeToEncrypted(user.id, conversationId(id));
	}

	@Patch("/conversations/:id")
	async rename(@PathParams("id") id: string, @BodyParams() request: RenameChatRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.rename(user.id, conversationId(id), request.name);
	}

	@Get("/conversations/:id/messages")
	async messages(@PathParams("id") id: string, @QueryParams("before") before?: string, @QueryParams("after") after?: string, @QueryParams("beforeSequence") beforeSequence?: string, @QueryParams("afterSequence") afterSequence?: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.messages(user.id, conversationId(id), {
			before: typeof before === "string" ? before : undefined,
			after: typeof after === "string" ? after : undefined,
			beforeSequence: typeof beforeSequence === "string" ? beforeSequence : undefined,
			afterSequence: typeof afterSequence === "string" ? afterSequence : undefined,
		});
	}

	@Get("/conversations/:id/mls/key-packages")
	async mlsKeyPackages(@PathParams("id") id: string, @QueryParams("lenient") lenient?: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { keyPackages: await this.chat.conversationMlsKeyPackages(user.id, conversationId(id), lenient === "1") };
	}

	@Post("/conversations/:id/mls/key-packages/:keyPackageId/claim")
	async claimMlsKeyPackage(@PathParams("id") id: string, @PathParams("keyPackageId") keyPackageId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(keyPackageId)) throw new BadRequest("The MLS key package ID is invalid.");
		return this.chat.claimMlsKeyPackage(user.id, conversationId(id), keyPackageId.toLowerCase());
	}

	@Get("/conversations/:id/mls/welcomes")
	async mlsWelcomes(@PathParams("id") id: string, @QueryParams("deviceId") deviceId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(deviceId)) throw new BadRequest("The chat device ID is invalid.");
		return {
			welcomes: await this.chat.pendingMlsWelcomes(user.id, conversationId(id), deviceId.toLowerCase()),
		};
	}

	@Post("/conversations/:id/mls/welcomes")
	@Returns(201)
	async storeMlsWelcome(@PathParams("id") id: string, @BodyParams() request: StoreChatMlsWelcomeRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(request.messageId) || request.recipients.some(({ deviceId, keyPackageId }) => !AuthService.isUuid(deviceId) || !AuthService.isUuid(keyPackageId))) {
			throw new BadRequest("The chat message or MLS Welcome recipient ID is invalid.");
		}
		const cid = conversationId(id);
		await this.chat.storeMlsWelcome(
			user.id,
			cid,
			request.messageId.toLowerCase(),
			request.recipients.map(({ deviceId, keyPackageId }) => ({
				deviceId: deviceId.toLowerCase(),
				keyPackageId: keyPackageId.toLowerCase(),
			})),
			request.welcome,
			request.ratchetTree,
		);
		return { stored: true };
	}

	@Post("/conversations/:id/mls/welcomes/:welcomeId/ack")
	@Returns(204)
	async acknowledgeMlsWelcome(@PathParams("id") id: string, @PathParams("welcomeId") welcomeId: string, @BodyParams() request: AcknowledgeChatMlsWelcomeRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(request.deviceId) || !AuthService.isUuid(welcomeId)) {
			throw new BadRequest("The chat device or Welcome ID is invalid.");
		}
		await this.chat.acknowledgeMlsWelcome(user.id, conversationId(id), request.deviceId.toLowerCase(), welcomeId.toLowerCase());
	}

	@Post("/conversations/:id/messages")
	@Returns(201)
	async send(@PathParams("id") id: string, @BodyParams() request: SendMessageRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (request.mlsDeviceId && !AuthService.isUuid(request.mlsDeviceId)) throw new BadRequest("The chat device ID is invalid.");
		return this.chat.send(user.id, conversationId(id), request.body, request.encrypted === true, request.mlsWelcome, request.mlsDeviceId?.toLowerCase());
	}

	@Post("/conversations/:id/read")
	@Returns(204)
	async read(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const cid = conversationId(id);
		await this.chat.conversation(user.id, cid);
		await this.chat.markRead(user.id, cid);
	}

	@Post("/conversations/:id/members")
	async addMembers(@PathParams("id") id: string, @BodyParams() request: AddMembersRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.addMembers(user.id, conversationId(id), request.usernames);
	}

	@Delete("/conversations/:id")
	@Returns(204)
	async deleteConversation(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.chat.deleteConversation(user.id, conversationId(id));
	}

	@Delete("/conversations/:id/members/:username")
	@Returns(204)
	async removeMember(@PathParams("id") id: string, @PathParams("username") username: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.chat.removeMember(user.id, conversationId(id), username);
	}
}
