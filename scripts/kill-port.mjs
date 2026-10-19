// Stops whatever process is listening on a TCP port (default 8083).
// Works on Windows, macOS and Linux. Usage: node scripts/kill-port.mjs [port]
import { execFileSync } from "node:child_process";

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
