import { Forbidden } from "@tsed/exceptions";
import type { IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";

export type ProducerRequestContext = {
	request: { req: IncomingMessage };
	response: { setHeader(name: string, value: string): unknown };
};

/** Do not trust forwarded headers when distributing an ingestion credential. */
export function requireProtectedProducerTransport(ctx: ProducerRequestContext): void {
	const socket = ctx.request.req.socket;
	const address = socket.remoteAddress ?? "";
	if (!(socket instanceof TLSSocket && socket.encrypted) &&
		address !== "::1" && address !== "127.0.0.1" && address !== "::ffff:127.0.0.1") {
		throw new Forbidden("Logger credentials require TLS or a loopback connection.");
	}
}
