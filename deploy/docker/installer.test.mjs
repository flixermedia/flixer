import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("installer AI selection and management commands preserve profiles and version pins", () => {
	const temp = mkdtempSync(join(tmpdir(), "flixer-install-test-"));
	try {
		const bin = join(temp, "bin");
		mkdirSync(bin);
		const log = join(temp, "docker.log");
		writeFileSync(join(bin, "docker"), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_LOG"
if [ "$1 $2 $3" = "compose config --environment" ]; then
  printf 'DATA_DIR=%s\\nHTTP_PORT=8080\\n' "$TEST_DATA"
fi
if [ "\${FAIL_PULL:-}" = yes ] && [ "$*" = "compose --env-file .env --env-file $TEST_DATA/updater-state/versions.env pull" ]; then exit 7; fi
`);
		writeFileSync(join(bin, "curl"), `#!/bin/bash
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    https://raw.githubusercontent.com/*) url=$1; shift ;;
		    http://localhost:*) exit 0 ;;
    *) shift ;;
  esac
done
file=\${url#*"/main/"}
cp "$TEST_ROOT/$file" "$out"
`);
		chmodSync(join(bin, "docker"), 0o755);
		chmodSync(join(bin, "curl"), 0o755);
		const dir = join(temp, "install with spaces");
		const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, TEST_LOG: log, TEST_DATA: join(dir, "data") };
		const run = (script, args, extra = {}) => spawnSync("bash", [join(root, script), ...args], { encoding: "utf8", env: { ...env, ...extra } });
		let result = run("install.sh", ["--yes", "--no-start", "--dir", dir]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(join(dir, ".env"), "utf8"), /^COMPOSE_PROFILES=ai$/m);
		assert.ok(readFileSync(join(dir, "manage.ps1"), "utf8").includes("wsl.exe"));
		const off = join(temp, "without-ai");
		result = run("install.sh", ["--yes", "--no-ai", "--no-start", "--dir", off]);
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(readFileSync(join(off, ".env"), "utf8"), /^COMPOSE_PROFILES=/m);
		writeFileSync(join(off, ".env"), "DATA_DIR=existing\nCOMPOSE_PROFILES=calls\n");
		const offCompose = readFileSync(join(off, "docker-compose.yml"), "utf8");
		result = run("install.sh", ["--yes", "--no-start", "--dir", off]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(join(off, ".env"), "utf8"), "DATA_DIR=existing\nCOMPOSE_PROFILES=calls\n");
		assert.equal(readFileSync(join(off, "docker-compose.yml"), "utf8"), offCompose);
		assert.match(result.stdout, /Images pulled; the stack was not started/);
		result = run("install.sh", ["--yes", "--fresh", "--dir", off]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /installation already exists/);
		assert.equal(readFileSync(join(off, ".env"), "utf8"), "DATA_DIR=existing\nCOMPOSE_PROFILES=calls\n");
		result = run("install.sh", ["--yes", "--update", "--dir", join(temp, "missing")]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /requires an existing/);
		result = run("install.sh", ["--yes", "--update", "--no-ai", "--dir", off]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /configuration options cannot be used/);
		const populated = join(temp, "populated");
		mkdirSync(populated);
		writeFileSync(join(populated, "keep"), "existing data");
		result = run("install.sh", ["--yes", "--fresh", "--no-start", "--dir", join(temp, "fresh"), "--data", populated]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /nonempty data directory/);
		assert.equal(readFileSync(join(populated, "keep"), "utf8"), "existing data");

		mkdirSync(join(dir, "data", "updater-state"), { recursive: true });
		writeFileSync(join(dir, "data", "updater-state", "versions.env"), "FLIXER_VERSION=1.2.3\n");
		result = run("install.sh", ["--yes", "--update", "--dir", dir]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(log, "utf8"), /versions\.env pull/);
		assert.match(readFileSync(log, "utf8"), /versions\.env up -d/);
		result = run("install.sh", ["--yes", "--update", "--dir", dir], { FAIL_PULL: "yes" });
		assert.equal(result.status, 7);
		for (const action of ["start", "stop", "restart", "update", "status"]) {
			result = spawnSync("bash", [join(dir, "manage.sh"), action], { encoding: "utf8", env });
			assert.equal(result.status, 0, `${action}: ${result.stderr}`);
		}
		const calls = readFileSync(log, "utf8");
		assert.match(calls, /compose --env-file \.env --env-file .*versions\.env pull/);
		assert.match(calls, /versions\.env up -d/);
		assert.match(calls, /versions\.env --profile \* stop/);
		assert.match(calls, /versions\.env ps/);
		result = spawnSync("bash", [join(dir, "manage.sh"), "update"], { encoding: "utf8", env: { ...env, FAIL_PULL: "yes" } });
		assert.equal(result.status, 7);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("PowerShell WSL bridge runs the Linux installer and manager through a native process", { skip: !process.env.FLIXER_TEST_PWSH }, () => {
	const temp = mkdtempSync(join(tmpdir(), "flixer-wsl-bridge-"));
	try {
		const bin = join(temp, "bin");
		const linuxHome = join(temp, "linux home");
		const managerDir = join(temp, "windows manager");
		mkdirSync(bin);
		mkdirSync(linuxHome);
		writeFileSync(join(bin, "wsl.exe"), `#!/bin/bash
export HOME="$TEST_WSL_HOME"
export WSL_DISTRO_NAME=Ubuntu
if [ "\${1:-}" = --distribution ]; then shift 2; fi
[ "$1" = --exec ] || exit 1
shift
if [ "\${1:-}" = bash ] && [ "\${2:-}" = -s ]; then
  script=$(cat)
  printf '%s\\r\\n' "$script" | "$@"
  exit $?
fi
exec "$@"
`);
		writeFileSync(join(bin, "docker"), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
  "context inspect "*) echo unix:///var/run/docker.sock ;;
  "info --format "*) echo "Ubuntu Linux" ;;
  "compose config --environment") printf 'DATA_DIR=%s\\nHTTP_PORT=8080\\n' "$TEST_WSL_HOME/flixer/data" ;;
esac
`);
		writeFileSync(join(bin, "curl"), `#!/bin/bash
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    https://raw.githubusercontent.com/*) url=$1; shift ;;
    *) shift ;;
  esac
done
file=\${url#*"/main/"}
if [ -n "\${out:-}" ]; then cp "$TEST_ROOT/$file" "$out"; else cat "$TEST_ROOT/$file"; fi
`);
		for (const name of ["wsl.exe", "docker", "curl"]) chmodSync(join(bin, name), 0o755);
		const driver = join(temp, "driver.ps1");
		writeFileSync(driver, `function global:Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    Copy-Item (Join-Path $env:TEST_ROOT 'manage.ps1') $OutFile
}
& (Join-Path $env:TEST_ROOT 'install.ps1') -Yes -NoStart -ManagementDir $env:TEST_MANAGER
& (Join-Path $env:TEST_ROOT 'install.ps1') -Yes -Update -ManagementDir $env:TEST_MANAGER
& (Join-Path $env:TEST_MANAGER 'manage.ps1') start
& (Join-Path $env:TEST_MANAGER 'manage.ps1') stop
`);
		const log = join(temp, "docker.log");
		const result = spawnSync(process.env.FLIXER_TEST_PWSH, ["-NoProfile", "-File", driver], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, TEST_WSL_HOME: linuxHome, TEST_MANAGER: managerDir, TEST_LOG: log },
		});
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		assert.match(readFileSync(join(linuxHome, "flixer", ".env"), "utf8"), /^COMPOSE_PROFILES=ai$/m);
		assert.match(readFileSync(log, "utf8"), /compose up -d/);
		assert.match(readFileSync(log, "utf8"), /compose pull/);
		assert.match(readFileSync(log, "utf8"), /compose --profile \* stop/);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
