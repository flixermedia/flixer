import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { dataPath } from "../../config/dataPath.js";

export interface MountTarget {
	id: string;
	host: string;
	share: string;
	username: string | null;
	domain: string | null;
	password: string | null;
	readOnly: boolean;
}

/** A failure with a message that is safe to show to an admin (secrets removed). */
export class MountError extends Error {}

const COMMAND_TIMEOUT_MS = 20_000;

/** Where shares are mounted on Linux and macOS. Windows connects to the UNC path directly. */
export function mountBaseDir(): string {
	return dataPath("mounts");
}

/** The folder the share's contents appear in on this server. */
export function localPathFor(target: Pick<MountTarget, "id" | "host" | "share">): string {
	return process.platform === "win32" ? `\\\\${target.host}\\${target.share}` : join(mountBaseDir(), target.id);
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
	if (!force && (await readdir(unc).then(() => true, () => false))) {
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
	const options = [
		target.username ? `username=${target.username}` : "guest",
		...(target.domain ? [`domain=${target.domain}`] : []),
		`uid=${process.getuid?.() ?? 0}`,
		`gid=${process.getgid?.() ?? 0}`,
		"file_mode=0644",
		"dir_mode=0755",
		"iocharset=utf8",
		"nosuid",
		"nodev",
		target.readOnly ? "ro" : "rw",
	].join(",");
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
	const auth = target.username
		? `${target.domain ? `${encodeURIComponent(target.domain)};` : ""}${encodeURIComponent(target.username)}${target.password ? `:${encodeURIComponent(target.password)}` : ""}`
		: "guest";
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
		await connectWindows(target, path, force);
	} else if (process.platform === "linux" || process.platform === "darwin") {
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

export async function unmountShare(target: Pick<MountTarget, "id" | "host" | "share">): Promise<void> {
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
