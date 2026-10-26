import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../api/auth/authService.js";
import { ChatService } from "./chatService.js";
import { AddMembersRequest, RenameChatRequest, SendMessageRequest, StartChatRequest } from "./chatRequests.js";

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
	) {}

	@Get("/conversations")
	async list(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.conversations(user.id);
	}

	@Get("/unread")
	async unread(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { count: await this.chat.unreadCount(user.id) };
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

	@Patch("/conversations/:id")
	async rename(
		@PathParams("id") id: string,
		@BodyParams() request: RenameChatRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.rename(user.id, conversationId(id), request.name);
	}

	@Get("/conversations/:id/messages")
	async messages(
		@PathParams("id") id: string,
		@QueryParams("before") before?: string,
		@QueryParams("after") after?: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.messages(user.id, conversationId(id), {
			before: typeof before === "string" ? before : undefined,
			after: typeof after === "string" ? after : undefined,
		});
	}

	@Post("/conversations/:id/messages")
	@Returns(201)
	async send(
		@PathParams("id") id: string,
		@BodyParams() request: SendMessageRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.send(user.id, conversationId(id), request.body);
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
	async addMembers(
		@PathParams("id") id: string,
		@BodyParams() request: AddMembersRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.chat.addMembers(user.id, conversationId(id), request.usernames);
	}

	@Delete("/conversations/:id/members/:username")
	@Returns(204)
	async removeMember(
		@PathParams("id") id: string,
		@PathParams("username") username: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.chat.removeMember(user.id, conversationId(id), username);
	}
}
