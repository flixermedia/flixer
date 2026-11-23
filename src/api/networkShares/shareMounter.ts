import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { createCipheriv, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataPath } from "../../config/dataPath.js";

export interface MountTarget {
	id: string;
	protocol: "smb" | "nfs" | "webdav" | "s3";
	host: string;
	share: string;
	username: string | null;
	domain: string | null;
	region: string | null;
	password: string | null;
	readOnly: boolean;
}

/** A failure with a message that is safe to show to an admin (secrets removed). */
export class MountError extends Error {}

const COMMAND_TIMEOUT_MS = 20_000;
const RCLONE_OBSCURE_KEY = Buffer.from([0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d, 0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b, 0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12, 0x8a, 0xfb, 0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38]);

/** Where shares are mounted on Linux and macOS. Windows connects to the UNC path directly. */
export function mountBaseDir(): string {
	return dataPath("mounts");
}

/** The folder the share's contents appear in on this server. */
export function localPathFor(target: Pick<MountTarget, "id" | "host" | "share"> & { protocol?: MountTarget["protocol"] }): string {
	return process.platform === "win32" && (target.protocol ?? "smb") === "smb" ? `\\\\${target.host}\\${target.share}` : join(mountBaseDir(), target.id);
}

function obscureRcloneSecret(value: string): string {

	const iv = randomBytes(16);
	const cipher = createCipheriv("aes-256-ctr", RCLONE_OBSCURE_KEY, iv);
	return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final()]).toString("base64url");

}

export function rcloneConfigFor(target: MountTarget): string {

	const remoteType = target.protocol === "webdav" ? "webdav" : "s3";
	const lines = ["[flixer]", `type = ${remoteType}`];
	if (remoteType === "webdav") {
		lines.push(`url = ${target.host}`, "vendor = other");
		if (target.username) {
			lines.push(`user = ${target.username}`);
		}
	} else {
		lines.push("provider = Other", `endpoint = ${target.host}`, `region = ${target.region || "us-east-1"}`, "force_path_style = true");
		if (target.username) {
			lines.push(`access_key_id = ${target.username}`);
		}
	}
	if (target.password) {
		lines.push(`${remoteType === "s3" ? "secret_access_key" : "pass"} = ${obscureRcloneSecret(target.password)}`);
	}
	return `${lines.join("\n")}\n`;

}

export function mountArgsFor(target: MountTarget, path: string, configPath = "/tmp/flixer-rclone.conf"): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {

	if (target.protocol === "nfs") {
		return { command: "mount", args: ["-t", "nfs", "-o", "ro,nosuid,nodev", `${target.host}:${target.share}`, path] };
	}
	if (target.protocol === "webdav" || target.protocol === "s3") {
		const remotePath = target.share === "/" ? "" : target.share.replace(/^\/+/, "");
		return {
			command: "rclone",
			args: ["mount", "--config", configPath, "--read-only", "--vfs-cache-mode", "full", "--allow-other", "--daemon", `flixer:${remotePath}`, path],
		};
	}
	const options = [target.username ? `username=${target.username}` : "guest", ...(target.domain ? [`domain=${target.domain}`] : []), `uid=${process.getuid?.() ?? 0}`, `gid=${process.getgid?.() ?? 0}`, "file_mode=0644", "dir_mode=0755", "iocharset=utf8", "nosuid", "nodev", target.readOnly ? "ro" : "rw"].join(",");
	return {
		command: "mount",
		args: ["-t", "cifs", `//${target.host}/${target.share}`, path, "-o", options],
		env: target.password ? { PASSWD: target.password } : undefined,
	};

}

function redact(text: string, secrets: string[]): string {

	let result = text;
	for (const secret of secrets) {
		if (secret) {
			result = result.split(secret).join("***");
		}
	}
	return result.replace(/\s+/g, " ").trim();

}

/** On Linux without root, SMB_MOUNT_SUDO=true runs mount/umount through passwordless sudo. */
function privileged(command: string, args: string[], env?: NodeJS.ProcessEnv): [string, string[]] {

	if (process.platform === "linux" && process.getuid?.() !== 0 && process.env.SMB_MOUNT_SUDO === "true") {
		const keep = Object.keys(env ?? {});
		return ["sudo", ["-n", ...(keep.length ? [`--preserve-env=${keep.join(",")}`] : []), command, ...args]];
	}
	return [command, args];

}

function run(command: string, args: string[], secrets: string[], env?: NodeJS.ProcessEnv): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
			if (!error) {
				resolvePromise(stdout);
				return;
			}
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				reject(new MountError(`"${command}" is not installed on this server.`));
				return;
			}
			if (error.killed) {
				reject(new MountError("The share did not respond in time."));
				return;
			}
			// error.message contains the whole command line, which may hold a password, so only the tool's own output is used.
			reject(new MountError(redact(`${stderr}\n${stdout}`, secrets) || `${command} failed.`));
		});
	});
}

function secretsOf(target: MountTarget): string[] {
	return target.password ? [target.password, encodeURIComponent(target.password)] : [];
}

async function isMounted(path: string): Promise<boolean> {

	if (process.platform === "linux") {
		const table = await readFile("/proc/self/mounts", "utf8").catch(() => "");
		const escaped = path.replace(/ /g, "\\040");
		return table.split("\n").some((line) => line.split(" ")[1] === escaped);
	}
	const output = await run("mount", [], []).catch(() => "");
	return output.includes(` on ${path} (`);

}

async function connectWindows(target: MountTarget, unc: string, force: boolean): Promise<void> {

	if (
		!force &&
		(await readdir(unc).then(
			() => true,
			() => false,
		))
	) {
		return;
	}
	await run("net", ["use", unc, "/delete", "/y"], []).catch(() => undefined);
	const args = ["use", unc];
	if (target.username) {
		// An explicit empty password stops net.exe from prompting and hanging.
		args.push(target.password ?? "", `/user:${target.domain ? `${target.domain}\\` : ""}${target.username}`);
	}
	args.push("/persistent:no");
	await run("net", args, secretsOf(target));

}

async function mountLinux(target: MountTarget, path: string): Promise<void> {

	if (target.protocol !== "smb") {
		if (target.protocol === "webdav" || target.protocol === "s3") {
			const directory = await mkdtemp(join(tmpdir(), "flixer-rclone-"));
			const configPath = join(directory, "rclone.conf");
			try {
				await writeFile(configPath, rcloneConfigFor(target), { mode: 0o600 });
				const { command, args, env } = mountArgsFor(target, path, configPath);
				const [privilegedCommand, privilegedArgs] = privileged(command, args, env);
				await run(privilegedCommand, privilegedArgs, secretsOf(target), env);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
			return;
		}
		const { command, args, env } = mountArgsFor(target, path);
		const [privilegedCommand, privilegedArgs] = privileged(command, args, env);
		try {
			await run(privilegedCommand, privilegedArgs, secretsOf(target), env);
		} catch (error: unknown) {
			if (error instanceof MountError && process.getuid?.() !== 0) {
				throw new MountError(`${error.message} NFS mounting needs root or SYS_ADMIN in Docker; use docker-compose.network-storage.yml.`);
			}
			throw error;
		}
		return;
	}
	const options = [target.username ? `username=${target.username}` : "guest", ...(target.domain ? [`domain=${target.domain}`] : []), `uid=${process.getuid?.() ?? 0}`, `gid=${process.getgid?.() ?? 0}`, "file_mode=0644", "dir_mode=0755", "iocharset=utf8", "nosuid", "nodev", target.readOnly ? "ro" : "rw"].join(",");
	try {
		// The password goes in the environment (PASSWD) so it never appears in the process list.
		const env = target.password ? { PASSWD: target.password } : undefined;
		const [command, args] = privileged("mount", ["-t", "cifs", `//${target.host}/${target.share}`, path, "-o", options], env);
		await run(command, args, secretsOf(target), env);
	} catch (error: unknown) {
		if (error instanceof MountError && process.getuid?.() !== 0) {
			throw new MountError(`${error.message} Mounting a share from inside the container needs root or the SYS_ADMIN capability (Linux hosts only, with docker-compose.smb.yml). On Docker Desktop (macOS/Windows) use docker-compose.smb-volume.yml instead, or mount the share yourself and list its folder in STREAM_MEDIA_ROOT.`);
		}
		throw error;
	}

}

async function mountMac(target: MountTarget, path: string): Promise<void> {

	const auth = target.username ? `${target.domain ? `${encodeURIComponent(target.domain)};` : ""}${encodeURIComponent(target.username)}${target.password ? `:${encodeURIComponent(target.password)}` : ""}` : "guest";
	const url = `//${auth}@${target.host}/${encodeURIComponent(target.share)}`;
	await run("mount_smbfs", [...(target.readOnly ? ["-o", "rdonly"] : []), url, path], secretsOf(target));

}

/**
 * Connects the share and returns the folder its contents appear in. With force the share is reconnected
 * (use it after the credentials changed); otherwise an existing connection is kept.
 */
export async function mountShare(target: MountTarget, force = false): Promise<string> {

	const path = localPathFor(target);
	if (process.platform === "win32") {
		if (target.protocol !== "smb") {
			throw new MountError(`${target.protocol} mounts are supported on Linux only.`);
		}
		await connectWindows(target, path, force);
	} else if (process.platform === "linux" || process.platform === "darwin") {
		if (target.protocol !== "smb" && process.platform !== "linux") {
			throw new MountError(`${target.protocol} mounts are supported on Linux only.`);
		}
		await mkdir(path, { recursive: true });
		if (await isMounted(path)) {
			if (!force) {
				return path;
			}
			await run(...privileged("umount", [path]), []);
		}
		await (process.platform === "linux" ? mountLinux(target, path) : mountMac(target, path));
	} else {
		throw new MountError(`Network shares are not supported on ${process.platform}.`);
	}

	await readdir(path).catch(() => {
		throw new MountError("Connected, but the share's contents cannot be read. Check the account's permissions on the share.");
	});
	return path;

}

export async function unmountShare(target: Pick<MountTarget, "id" | "host" | "share"> & { protocol?: MountTarget["protocol"] }): Promise<void> {

	const path = localPathFor(target);
	if (process.platform === "win32") {
		await run("net", ["use", path, "/delete", "/y"], []).catch(() => undefined);
		return;
	}
	if (await isMounted(path)) {
		await run(...privileged("umount", [path]), []);
	}
	await rmdir(path).catch(() => undefined);

}
