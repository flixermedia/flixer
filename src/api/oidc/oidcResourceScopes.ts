export const OIDC_RESOURCE_SCOPES = [
	"subscriptions:read", "entitlements:read", "purchases:read", "access:check",
	"library:read", "favorites:read", "playlists:read", "progress:read", "history:read", "preferences:read",
] as const;

export type OidcResourceScope = (typeof OIDC_RESOURCE_SCOPES)[number];

export function isOidcResourceScope(value: string): value is OidcResourceScope {
	return (OIDC_RESOURCE_SCOPES as readonly string[]).includes(value);
}
