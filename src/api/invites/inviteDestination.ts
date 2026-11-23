import type { DataSource } from "typeorm";
import type { Invitation } from "../../entities/invitation.entity.js";
import { InvitationUsage } from "../../entities/invitationUsage.entity.js";
import type { InviteServerType } from "../../entities/inviteServer.entity.js";

export type InviteDestinationType = "flixer" | InviteServerType;

/** What the invited person is told about where they just got access to. */
export interface InviteDestination {
	type: InviteDestinationType;
	name: string | null;
	url: string | null;
	instructions: string | null;
	/** True when Plex sent its own invite to the given email address instead of creating an account here. */
	invitedByEmail: boolean;
}

const SERVER_TYPE_LABELS: Record<InviteDestinationType, string> = {
	flixer: "Flixer",
	jellyfin: "Jellyfin",
	emby: "Emby",
	plex: "Plex",
	other: "Media Server",
};

/** Display name for an invite destination (e.g. "Jellyfin", "Plex", "Emby", or the Flixer app name). */
export function destinationLabel(destination: Pick<InviteDestination, "type" | "name">, fallbackAppName = "Flixer"): string {
	if (destination.type === "flixer") {
		return fallbackAppName;
	}
	return destination.name?.trim() || SERVER_TYPE_LABELS[destination.type];
}

/** Link to open the invited server, falling back to Plex Web for Plex or the Flixer URL for Flixer invites. */
export function destinationOpenUrl(destination: Pick<InviteDestination, "type" | "url">, fallbackAppUrl: string): string {
	if (destination.type === "flixer") {
		return fallbackAppUrl;
	}
	const configured = destination.url?.trim();
	if (configured) {
		return configured;
	}
	return destination.type === "plex" ? "https://app.plex.tv" : fallbackAppUrl;
}

/** Guidance shown in welcome emails explaining how to sign in on the invited server. */
export function destinationCredentialsNote(destination: Pick<InviteDestination, "type" | "invitedByEmail">): string {
	if (destination.type === "jellyfin" || destination.type === "emby") {
		return "Sign in with the username and password you chose when accepting the invitation.";
	}
	if (destination.type === "plex") {
		return destination.invitedByEmail ? "Plex sent an invitation to your email address. Accept it there to finish setting up access." : "Sign in with your Plex account to start watching right away.";
	}
	return "";
}

/** Builds an InviteDestination from an invitation and whether Plex sent an email invite. */
export function buildInviteDestination(invitation: Pick<Invitation, "serverId" | "server">, invitedByEmail = false): InviteDestination {
	const server = invitation.server;
	if (!invitation.serverId || !server) {
		return { type: "flixer", name: null, url: null, instructions: null, invitedByEmail: false };
	}
	return {
		type: server.type,
		name: server.name,
		url: server.externalUrl?.trim() || server.url,
		instructions: server.instructions,
		invitedByEmail,
	};
}

/** Returns the invitation destination for a user who registered through an invite, or null for normal registrations. */
export async function findInviteDestinationForUser(dataSource: DataSource, userId: string): Promise<InviteDestination | null> {
	const usage = await dataSource.getRepository(InvitationUsage).findOne({
		where: { userId },
		relations: { invitation: { server: true } },
		order: { createdAt: "DESC" },
	});
	if (!usage?.invitation) {
		return null;
	}
	return buildInviteDestination(usage.invitation, Boolean(usage.externalEmail));
}
