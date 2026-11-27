import os from "node:os";
import { BadGateway, BadRequest, Forbidden, ServiceUnavailable } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import type { DataSource } from "typeorm";
import { ChatService } from "../../chat/chatService.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { runtimeVersion } from "../../config/runtimeVersion.js";
import { CloudEntitlementService } from "./cloudEntitlementService.js";

const PRIORITY_SUPPORT_FEATURE = "priority_support";
const REQUEST_TIMEOUT_MS = 20_000;
const TICKET_CHATS_SETTING_KEY = "priority_support_ticket_chats";
const TICKET_SYNC_INTERVAL_MS = 10_000;

interface TicketChatMappingEntry {
	conversationId: string;
	syncedMessageIds: string[];
}

export interface SupportChatAttachment {
	name: string;
	url: string;
	contentType?: string;
}

export interface SupportChatAttachmentInput {
	dataUrl: string;
	name?: string;
}

export interface SupportChatMessage {
	id: string;
	sender: "customer" | "agent";
	senderName: string;
	text: string;
	timestamp: string;
	attachments?: SupportChatAttachment[];
}

export interface SupportRealtimeConfig {
	wsUrl: string;
	rid: string;
	visitorToken: string;
}

export interface SupportChatState {
	room: { rid: string; open: boolean } | null;
	messages: SupportChatMessage[];
	realtime?: SupportRealtimeConfig | null;
}

export interface ServerDiagnosticsSummary {
	flixerVersion: string;
	nodeVersion: string;
	platform: string;
	arch: string;
	uptimeSeconds: number;
	instanceId: string | null;
	linkId: string | null;
	activePlans: string[];
	activeFeatures: string[];
	formattedText: string;
}

@Injectable()
export class PrioritySupportService {

	private ticketSyncTimer?: NodeJS.Timeout;

	constructor(
		private readonly cloudEntitlements: CloudEntitlementService,
		@Inject(DefaultDataSource) private readonly dataSource?: DataSource,
		private readonly chatService?: ChatService,
	) {
		if (this.chatService) {
			this.chatService.setSupportTicketHandlers({
				onMessage: (conversationId, body) => this.handleChatTicketMessage(conversationId, body),
				onSync: (conversationId) => this.syncTicketConversation(conversationId),
				onDelete: (conversationId) => this.handleChatTicketDeleted(conversationId),
			});
			this.startTicketSyncLoop();
		}
	}

	private startTicketSyncLoop(): void {
		if (this.ticketSyncTimer || !this.dataSource || !this.chatService) return;
		this.ticketSyncTimer = setInterval(() => {
			void this.syncAllTicketConversations().catch(() => undefined);
		}, TICKET_SYNC_INTERVAL_MS);
		this.ticketSyncTimer.unref();
	}

	private async loadTicketChatMap(): Promise<Record<string, TicketChatMappingEntry>> {
		if (!this.dataSource) return {};
		const row = await this.dataSource.getRepository(Setting).findOne({ where: { key: TICKET_CHATS_SETTING_KEY } });
		if (!row || typeof row.value !== "object" || row.value === null) return {};
		return row.value as Record<string, TicketChatMappingEntry>;
	}

	private async saveTicketChatMap(map: Record<string, TicketChatMappingEntry>): Promise<void> {
		if (!this.dataSource) return;
		const repo = this.dataSource.getRepository(Setting);
		const existing = await repo.findOne({ where: { key: TICKET_CHATS_SETTING_KEY } });
		if (existing) {
			await repo.update({ id: existing.id }, { value: map });
		} else {
			await repo.insert({ key: TICKET_CHATS_SETTING_KEY, value: map, isPublic: false });
		}
	}

	private async findTicketIdByConversation(conversationId: string): Promise<string | null> {
		const map = await this.loadTicketChatMap();
		for (const [ticketId, entry] of Object.entries(map)) {
			if (entry.conversationId === conversationId) return ticketId;
		}
		return null;
	}

	private async handleChatTicketMessage(conversationId: string, body: string): Promise<void> {
		const ticketId = await this.findTicketIdByConversation(conversationId);
		if (!ticketId) return;
		await this.replyTicket(ticketId, body);
	}

	private async handleChatTicketDeleted(conversationId: string): Promise<void> {
		const ticketId = await this.findTicketIdByConversation(conversationId);
		if (!ticketId) return;
		const map = await this.loadTicketChatMap();
		delete map[ticketId];
		await this.saveTicketChatMap(map);
		await this.deleteRemoteTicket(ticketId).catch(() => undefined);
	}

	private async syncTicketMessagesToChat(
		ticketId: string,
		remoteMessages: Array<{ id?: string; sender?: string; senderName?: string; text?: string }>,
	): Promise<string | null> {
		if (!this.chatService) return null;
		const map = await this.loadTicketChatMap();
		const entry = map[ticketId];
		if (!entry) return null;
		const seen = new Set(entry.syncedMessageIds);
		let changed = false;
		for (const msg of remoteMessages) {
			if (!msg.id || msg.sender !== "agent" || !msg.text || seen.has(msg.id)) continue;
			const label = msg.senderName && msg.senderName !== "Flixer Support" ? `${msg.senderName}: ` : "";
			await this.chatService.insertSupportTicketReply(entry.conversationId, `${label}${msg.text}`);
			seen.add(msg.id);
			changed = true;
		}
		if (changed) {
			map[ticketId] = { ...entry, syncedMessageIds: [...seen].slice(-200) };
			await this.saveTicketChatMap(map);
		}
		return entry.conversationId;
	}

	private async syncTicketConversation(conversationId: string): Promise<void> {
		const ticketId = await this.findTicketIdByConversation(conversationId);
		if (!ticketId) return;
		await this.getTicket(ticketId);
	}

	private async syncAllTicketConversations(): Promise<void> {
		const map = await this.loadTicketChatMap();
		const ticketIds = Object.keys(map);
		if (ticketIds.length === 0) return;
		for (const ticketId of ticketIds) {
			await this.getTicket(ticketId).catch(() => undefined);
		}
	}

	private async ensureEntitledToken(): Promise<string> {
		await this.cloudEntitlements.requireFeature(PRIORITY_SUPPORT_FEATURE);
		return this.cloudEntitlements.getValidAccessToken();
	}

	async getDiagnostics(): Promise<ServerDiagnosticsSummary> {
		await this.cloudEntitlements.requireFeature(PRIORITY_SUPPORT_FEATURE);
		const status = await this.cloudEntitlements.getStatus();
		const flixerVersion = runtimeVersion();
		const nodeVersion = process.version;
		const platform = `${os.type()} ${os.release()}`;
		const arch = os.arch();
		const uptimeSeconds = Math.floor(process.uptime());
		const activePlans = status.plans.filter((p) => p.active).map((p) => `${p.name} (${p.id})`);
		const activeFeatures = status.features;

		const formattedText = [
			"--- Flixer Server Diagnostics ---",
			`Flixer Version: ${flixerVersion}`,
			`Runtime: Node ${nodeVersion} on ${platform} (${arch})`,
			`Uptime: ${uptimeSeconds}s`,
			`Instance ID: ${status.instanceId || "unknown"}`,
			`Cloud Link ID: ${status.linkId || "unknown"}`,
			`Active Plans: ${activePlans.length > 0 ? activePlans.join(", ") : "none"}`,
			`Last Cloud Sync: ${status.syncedAt || "never"}`,
		].join("\n");

		return {
			flixerVersion,
			nodeVersion,
			platform,
			arch,
			uptimeSeconds,
			instanceId: status.instanceId,
			linkId: status.linkId,
			activePlans,
			activeFeatures,
			formattedText,
		};
	}

	async getMessages(): Promise<SupportChatState> {
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportChat`;
		const response = await fetch(url, {
			method: "GET",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		return this.handleCloudSupportResponse<SupportChatState>(response);
	}

	async getAttachment(attachmentPath: string): Promise<{ buffer: Buffer; contentType: string }> {
		const trimmed = attachmentPath.trim();
		const isLegacyPath = trimmed.startsWith("/file-upload/");
		const isDiscordCdn = trimmed.startsWith("https://cdn.discordapp.com/") || trimmed.startsWith("https://media.discordapp.net/");
		if (!isLegacyPath && !isDiscordCdn) {
			throw new BadRequest("Invalid attachment path.");
		}
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportChat?attachment=${encodeURIComponent(trimmed)}`;
		const response = await fetch(url, {
			method: "GET",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) {
			return this.handleCloudSupportResponse<never>(response);
		}
		const contentType = response.headers.get("content-type") || "application/octet-stream";
		const buffer = Buffer.from(await response.arrayBuffer());
		return { buffer, contentType };
	}

	async closeSession(): Promise<{ closed: boolean; room: null }> {
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportChat`;
		const response = await fetch(url, {
			method: "DELETE",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		return this.handleCloudSupportResponse<{ closed: boolean; room: null }>(response);
	}

	async sendMessage(
		message: string,
		attachment?: SupportChatAttachmentInput,
	): Promise<{ room: { rid: string; open: boolean } | null; message: SupportChatMessage; realtime?: SupportRealtimeConfig | null }> {
		const trimmed = message.trim();
		const hasAttachment = Boolean(attachment?.dataUrl);
		if ((!trimmed && !hasAttachment) || trimmed.length > 4000) {
			throw new BadRequest("Message must be between 1 and 4000 characters or include a screenshot.");
		}
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportChat`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				message: trimmed,
				...(hasAttachment ? { attachment } : {}),
			}),
			signal: AbortSignal.timeout(hasAttachment ? 25_000 : REQUEST_TIMEOUT_MS),
		});
		return this.handleCloudSupportResponse<{ room: { rid: string; open: boolean } | null; message: SupportChatMessage; realtime?: SupportRealtimeConfig | null }>(response);
	}

	async listTickets(): Promise<{ tickets: Array<Record<string, unknown>> }> {
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportTickets`;
		const response = await fetch(url, {
			method: "GET",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const data = await this.handleCloudSupportResponse<{ tickets: Array<Record<string, unknown>> }>(response);
		const map = await this.loadTicketChatMap();
		return {
			tickets: (data.tickets ?? []).map((t) => {
				const id = typeof t.id === "string" ? t.id : "";
				return { ...t, conversationId: id ? map[id]?.conversationId ?? null : null };
			}),
		};
	}

	async getTicket(ticketId: string, userId?: string): Promise<{ ticket: Record<string, unknown>; messages: Array<Record<string, unknown>>; conversationId: string | null }> {
		const trimmed = ticketId.trim();
		if (!trimmed) throw new BadRequest("Ticket ID is required.");
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportTickets?ticketId=${encodeURIComponent(trimmed)}`;
		const response = await fetch(url, {
			method: "GET",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const data = await this.handleCloudSupportResponse<{ ticket: Record<string, unknown>; messages: Array<{ id?: string; sender?: string; senderName?: string; text?: string }> }>(response);
		let conversationId = await this.syncTicketMessagesToChat(trimmed, data.messages ?? []);
		if (!conversationId && this.chatService && userId) {
			const subject = typeof data.ticket?.subject === "string" ? data.ticket.subject : "Support Ticket";
			const firstCustomerMsg = (data.messages ?? []).find((m) => m.sender === "customer" && m.text)?.text || subject;
			const conv = await this.chatService.createSupportTicketChat(userId, `Ticket: ${subject}`.slice(0, 60), firstCustomerMsg);
			const map = await this.loadTicketChatMap();
			map[trimmed] = { conversationId: conv.id, syncedMessageIds: [] };
			await this.saveTicketChatMap(map);
			conversationId = await this.syncTicketMessagesToChat(trimmed, data.messages ?? []);
		}
		return { ...data, conversationId };
	}

	async createTicket(subject: string, message: string, category = "general", userId?: string): Promise<{ ticket: Record<string, unknown>; messages: unknown[]; conversationId: string | null }> {
		const trimmedSubject = subject.trim();
		const trimmedMessage = message.trim();
		if (!trimmedSubject || trimmedSubject.length > 160) {
			throw new BadRequest("Subject must be between 1 and 160 characters.");
		}
		if (!trimmedMessage || trimmedMessage.length > 2000) {
			throw new BadRequest("Message must be between 1 and 2000 characters.");
		}
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportTickets`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ subject: trimmedSubject, message: trimmedMessage, category }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const data = await this.handleCloudSupportResponse<{ ticket: Record<string, unknown>; messages: unknown[] }>(response);
		let conversationId: string | null = null;
		const ticketId = typeof data.ticket?.id === "string" ? data.ticket.id : "";
		if (ticketId && this.chatService && userId) {
			const conv = await this.chatService.createSupportTicketChat(userId, `Ticket: ${trimmedSubject}`.slice(0, 60), trimmedMessage);
			const map = await this.loadTicketChatMap();
			map[ticketId] = { conversationId: conv.id, syncedMessageIds: [] };
			await this.saveTicketChatMap(map);
			conversationId = conv.id;
		}
		return { ...data, conversationId };
	}

	async replyTicket(ticketId: string, message: string): Promise<{ ticket: unknown; message: unknown }> {
		const trimmedId = ticketId.trim();
		const trimmedMessage = message.trim();
		if (!trimmedId) throw new BadRequest("Ticket ID is required.");
		if (!trimmedMessage || trimmedMessage.length > 2000) {
			throw new BadRequest("Message must be between 1 and 2000 characters.");
		}
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportTickets`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ticketId: trimmedId, message: trimmedMessage }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		return this.handleCloudSupportResponse<{ ticket: unknown; message: unknown }>(response);
	}

	private async deleteRemoteTicket(ticketId: string): Promise<{ deleted: boolean; ticketId: string }> {
		const trimmedId = ticketId.trim();
		if (!trimmedId) throw new BadRequest("Ticket ID is required.");
		const accessToken = await this.ensureEntitledToken();
		const url = `${this.cloudEntitlements.getCloudApiBaseUrl()}/prioritySupportTickets?ticketId=${encodeURIComponent(trimmedId)}`;
		const response = await fetch(url, {
			method: "DELETE",
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		return this.handleCloudSupportResponse<{ deleted: boolean; ticketId: string }>(response);
	}

	async deleteTicket(ticketId: string): Promise<{ deleted: boolean; ticketId: string }> {
		const trimmedId = ticketId.trim();
		const result = await this.deleteRemoteTicket(trimmedId);
		const map = await this.loadTicketChatMap();
		const entry = map[trimmedId];
		if (entry) {
			delete map[trimmedId];
			await this.saveTicketChatMap(map);
			if (this.chatService) {
				await this.chatService.deleteSupportTicketConversation(entry.conversationId).catch(() => undefined);
			}
		}
		return result;
	}

	private async handleCloudSupportResponse<T>(response: Response): Promise<T> {
		const data = (await response.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
		if (response.ok) {
			return data;
		}
		const description = data.error_description || data.error || `Flixer Cloud returned ${response.status}.`;
		if (response.status === 403 || response.status === 401) {
			throw new Forbidden(description);
		}
		if (response.status === 400) {
			throw new BadRequest(description);
		}
		if (response.status === 503) {
			throw new ServiceUnavailable(description);
		}
		throw new BadGateway(description);
	}
}
