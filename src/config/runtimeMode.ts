/**
 * Runtime mode helper for running Flixer either as a full media server stack or as a
 * standalone invite & user management system.
 */
export function isInvitesOnlyMode(): boolean {
	return process.env.FLIXER_MODE === "invites" || process.env.STANDALONE_INVITES === "true";
}
