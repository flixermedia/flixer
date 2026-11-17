/** Close codes sent to clients. 4401/4403 mean "do not reconnect with the same credentials". */
export const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;

export function closeCodeFor(error: unknown): number {
	const status = (error as { status?: number } | null)?.status;
	return status === 403 ? CLOSE_FORBIDDEN : CLOSE_UNAUTHORIZED;
}
