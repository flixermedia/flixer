import os from "node:os";
import { BadGateway, BadRequest, Forbidden, ServiceUnavailable } from "@tsed/exceptions";
import { Injectable } from "@tsed/di";
import { runtimeVersion } from "../../config/runtimeVersion.js";
import { CloudEntitlementService } from "./cloudEntitlementService.js";

const PRIORITY_SUPPORT_FEATURE = "priority_support";
const REQUEST_TIMEOUT_MS = 10_000;

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

	constructor(private readonly cloudEntitlements: CloudEntitlementService) {}

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
		if (!trimmed.startsWith("/file-upload/")) {
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
