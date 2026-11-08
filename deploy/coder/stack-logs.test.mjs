import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const setup = readFileSync(new URL("./scripts/setup.sh", import.meta.url), "utf8");
const match = setup.match(/cat > "\$HOME\/bin\/flixer-stack" <<'EOS'\n([\s\S]*?)\nEOS/);
assert.ok(match, "stack supervisor must be embedded in the setup script");

async function fixture(t, socketMode) {
	const root = mkdtempSync(join(tmpdir(), "flixer-stack-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const socket = join(root, "docker.sock");
	const server = createServer();
	await new Promise((resolve, reject) => server.once("error", reject).listen(socket, resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	chmodSync(socket, socketMode);

	const stack = join(root, "stack");
	writeFileSync(stack, match[1].replaceAll("/var/run/docker.sock", socket));
	writeFileSync(join(root, "docker"), `#!/usr/bin/env bash
if [ "$1" = context ] && [ "$2" = show ]; then
  printf '%s\\n' "\${MOCK_DOCKER_CONTEXT:-default}"
  exit 0
fi
printf 'docker args: %s\\n' "$*" >&2
printf '[api] api line\\n[logger] logger line\\n'
exit "\${MOCK_DOCKER_EXIT:-0}"
`, { mode: 0o755 });
	writeFileSync(join(root, "sudo"), `#!/usr/bin/env bash
printf 'sudo args: %s\\n' "$*" >&2
[ "\${MOCK_SUDO_FAIL:-0}" = 0 ] || exit 1
shift
if [ "$1" = true ]; then exit 0; fi
exec "$@"
`, { mode: 0o755 });

	return (args, env = {}) => spawnSync("bash", [stack, "logs", ...args], {
		encoding: "utf8",
		env: { ...process.env, HOME: root, PATH: `${root}:${process.env.PATH}`, WORKSPACE_CONTAINER_NAME: "workspace", DOCKER_HOST: "", DOCKER_CONTEXT: "", ...env },
	});
}

test("reads logs directly when the socket is writable", async (t) => {
	const run = await fixture(t, 0o600);
	const result = run([]);
	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(result.stderr, /sudo args/);
	assert.match(result.stdout, /\[api\] api line/);
	assert.match(result.stdout, /\[logger\] logger line/);
});

test("uses sudo for an inaccessible default socket and filters service logs", async (t) => {
	const run = await fixture(t, 0o000);
	const result = run(["logger"]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /sudo args: -n docker --host unix:\/\//);
	assert.equal(result.stdout, "[logger] logger line\n");
});

test("reports when passwordless sudo is unavailable", async (t) => {
	const run = await fixture(t, 0o000);
	const result = run([], { MOCK_SUDO_FAIL: "1" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /passwordless sudo is unavailable/);
	assert.doesNotMatch(result.stderr, /docker args/);
});

test("does not override an explicit Docker host or configured context", async (t) => {
	const run = await fixture(t, 0o000);
	for (const env of [{ DOCKER_HOST: "tcp://localhost:2375" }, { DOCKER_CONTEXT: "remote" }, { MOCK_DOCKER_CONTEXT: "remote" }]) {
		const result = run([], env);
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stderr, /sudo args/);
	}
});

test("propagates Docker failures for filtered logs", async (t) => {
	const run = await fixture(t, 0o600);
	const result = run(["logger"], { MOCK_DOCKER_EXIT: "42" });
	assert.equal(result.status, 42);
});
