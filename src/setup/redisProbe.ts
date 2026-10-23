import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { parseRedisUrl } from "../config/store/redisConfig.js";

export type RedisProbe = { ok: true } | { ok: false; message: string };

const TIMEOUT_MS = 5000;

function command(...parts: string[]): string {
	return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

/** Checks a Redis URL with AUTH, SELECT and PING over a plain or TLS socket, so the API needs no Redis client. */
export function probeRedis(url: string): Promise<RedisProbe> {
	let config: ReturnType<typeof parseRedisUrl>;
	try {
		config = parseRedisUrl(url);
	} catch (error: unknown) {
		return Promise.resolve({ ok: false, message: error instanceof Error ? error.message : "Invalid Redis URL." });
	}
	const [host, port] = [config.addr.slice(0, config.addr.lastIndexOf(":")), Number(config.addr.slice(config.addr.lastIndexOf(":") + 1))];
	const commands: string[] = [];
	if (config.password) {
		commands.push(command(...(config.username ? ["AUTH", config.username, config.password] : ["AUTH", config.password])));
	}
	if (config.db > 0) {
		commands.push(command("SELECT", String(config.db)));
	}
	commands.push(command("PING"));

	return new Promise((resolve) => {
		let socket: Socket;
		let buffer = "";
		let settled = false;
		const finish = (result: RedisProbe) => {
			if (!settled) {
				settled = true;
				socket?.destroy();
				resolve(result);
			}
		};
		const fail = (message: string) => finish({ ok: false, message: message.split(config.password || "\0").join("***") });
		try {
			socket = config.tls ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
		} catch (error: unknown) {
			fail(error instanceof Error ? error.message : String(error));
			return;
		}
		socket.setTimeout(TIMEOUT_MS, () => fail("Redis did not respond in time."));
		socket.on("error", (error) => fail(error.message));
		socket.on(config.tls ? "secureConnect" : "connect", () => socket.write(commands.join("")));
		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			const lines = buffer.split("\r\n").filter(Boolean);
			const error = lines.find((line) => line.startsWith("-"));
			if (error) {
				fail(error.slice(1));
			} else if (lines.length >= commands.length) {
				finish(lines[lines.length - 1] === "+PONG" ? { ok: true } : { ok: false, message: "Unexpected reply to PING." });
			}
		});
	});
}
