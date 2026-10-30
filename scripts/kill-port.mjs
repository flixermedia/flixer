// Stops whatever process is listening on a TCP port (default 8083).
// Works on Windows, macOS and Linux. Usage: node scripts/kill-port.mjs [port]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

const port = Number(process.argv[2] ?? 8083);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error(`Invalid port: ${process.argv[2]}`);
	process.exit(1);
}

const run = (cmd, args) => {
	try {
		return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return "";
	}
};

function findPids() {
	const pids = new Set();
	if (process.platform === "win32") {
		for (const line of run("netstat", ["-ano", "-p", "TCP"]).split(/\r?\n/)) {
			const cols = line.trim().split(/\s+/);
			if (cols.length >= 5 && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) {
				pids.add(cols[4]);
			}
		}
	} else {
		for (const pid of run("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"]).split(/\s+/)) {
			if (pid) pids.add(pid);
		}
		if (!pids.size) {
			// Fallback for systems without lsof
			const match = run("ss", ["-ltnpH", `sport = :${port}`]).matchAll(/pid=(\d+)/g);
			for (const m of match) pids.add(m[1]);
		}
		if (!pids.size && process.platform === "linux") {
			const inodes = new Set();
			for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
				try {
					for (const line of readFileSync(table, "utf8").split(/\r?\n/).slice(1)) {
						const columns = line.trim().split(/\s+/);
						if (columns.length >= 10 && columns[3] === "0A" && Number.parseInt(columns[1].split(":").at(-1), 16) === port) {
							inodes.add(columns[9]);
						}
					}
				} catch {
					// The table may be unavailable in restricted containers.
				}
			}
			if (inodes.size) {
				try {
					for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
						try {
							for (const fd of readdirSync(`/proc/${pid}/fd`)) {
								const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
								const match = target.match(/^socket:\[(\d+)\]$/);
								if (match && inodes.has(match[1])) pids.add(pid);
							}
						} catch {
							// Processes can exit or be hidden while descriptors are scanned.
						}
					}
				} catch {
					// /proc may be unavailable or restricted.
				}
			}
		}
	}
	pids.delete("0");
	return [...pids];
}

const pids = findPids();
if (!pids.length) {
	console.log(`Nothing is listening on port ${port}.`);
	process.exit(0);
}

let failed = false;
for (const pid of pids) {
	try {
		if (process.platform === "win32") {
			execFileSync("taskkill", ["/PID", pid, "/F", "/T"], { stdio: "ignore" });
		} else {
			process.kill(Number(pid), "SIGKILL");
		}
		console.log(`Stopped process ${pid} on port ${port}.`);
	} catch (err) {
		failed = true;
		console.error(`Failed to stop process ${pid}: ${err.message}`);
	}
}
process.exit(failed ? 1 : 0);
