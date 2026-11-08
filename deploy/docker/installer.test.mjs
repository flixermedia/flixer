import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
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
if [ "\${REAL_CONFIG:-}" = yes ]; then
  case "$*" in "compose config --environment" | "compose -f "*" config --environment") exec "$REAL_DOCKER" "$@" ;; esac
fi
case "$*" in
  "compose config --environment" | "compose -f "*" config --environment") printf 'DATA_DIR=%s\\nMEDIA_PATH=%s\\nHTTP_PORT=%s\\n' "$TEST_DATA" "$TEST_MEDIA" "\${TEST_PORT:-8080}" ;;
esac
if [ "\${FAIL_DOWN:-}" = yes ]; then
  case "$*" in "compose --profile * down" | "compose -f "*" --profile * down") exit 8 ;; esac
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
		const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, TEST_LOG: log, TEST_DATA: join(dir, "data"), TEST_MEDIA: join(dir, "media") };
		const run = (script, args, extra = {}) => spawnSync("bash", [join(root, script), ...args], { encoding: "utf8", env: { ...env, ...extra } });
		let result = run("install.sh", ["--yes", "--no-start", "--dir", dir]);
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(join(dir, ".env"), "utf8"), /^COMPOSE_PROFILES=ai$/m);
		assert.ok(readFileSync(join(dir, "manage.ps1"), "utf8").includes("wsl.exe"));
		const off = join(temp, "without-ai");
		result = run("install.sh", ["--yes", "--no-ai", "--no-start", "--dir", off]);
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(readFileSync(join(off, ".env"), "utf8"), /^COMPOSE_PROFILES=/m);
		writeFileSync(join(bin, "uname"), "#!/bin/bash\necho Darwin\n");
		chmodSync(join(bin, "uname"), 0o755);
		const mac = join(temp, "mac");
		result = run("install.sh", ["--yes", "--no-start", "--dir", mac]);
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(readFileSync(join(mac, ".env"), "utf8"), /^MEILISEARCH_STORAGE=/m);
		rmSync(join(bin, "uname"));
		writeFileSync(join(off, ".env"), "DATA_DIR=existing\nCOMPOSE_PROFILES=calls\n");
		const offCompose = readFileSync(join(off, "docker-compose.yml"), "utf8");
		result = run("install.sh", ["--yes", "--no-start", "--dir", off]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(join(off, ".env"), "utf8"), "DATA_DIR=existing\nCOMPOSE_PROFILES=calls\n");
		assert.equal(readFileSync(join(off, "docker-compose.yml"), "utf8"), offCompose);
		assert.match(result.stdout, /Images pulled; the stack was not started/);
		result = run("install.sh", ["--yes", "--fresh", "--dir", off]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /not confirmed/);
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

		writeFileSync(join(dir, "data", "database-marker"), "database");
		writeFileSync(join(dir, "media", "movie"), "media");
		const composePath = join(dir, "docker-compose.yml");
		writeFileSync(composePath, readFileSync(composePath, "utf8").replace('"CMD-SHELL", "curl -fsS http://127.0.0.1:7700/health', '"xCMD-SHELL", "curl -fsS http://127.0.0.1:7700/health'));
		const originalEnv = readFileSync(join(dir, ".env"), "utf8");
		const dockerPath = spawnSync("which", ["docker"], { encoding: "utf8" }).stdout?.trim();
		if (dockerPath && spawnSync(dockerPath, ["compose", "version"], { encoding: "utf8" }).status === 0) {
			result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--dry-run", "--no-start", "--dir", dir], { REAL_CONFIG: "yes", REAL_DOCKER: dockerPath });
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /temporary correction/);
		}
		result = run("install.sh", ["--yes", "--fresh", "--no-start", "--dir", dir]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /not confirmed/);
		assert.ok(!readdirSync(dir).some((name) => name.startsWith(".flixer-reset-compose.")));
		assert.equal(readFileSync(join(dir, "data", "database-marker"), "utf8"), "database");
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir], { TEST_MEDIA: join(dir, "data") });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /MEDIA_PATH/);
		symlinkSync(join(dir, "data"), join(temp, "data-link"));
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir], { TEST_DATA: join(temp, "data-link") });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /not a symlink/);
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir], { TEST_DATA: "/" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /broad or installation directory/);
		writeFileSync(join(bin, "uname"), "#!/bin/bash\necho Darwin\n");
		writeFileSync(join(bin, "mount"), '#!/bin/bash\nprintf "volume on %s/nested (apfs, local)\\n" "$TEST_DATA"\n');
		chmodSync(join(bin, "uname"), 0o755);
		chmodSync(join(bin, "mount"), 0o755);
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /contains a mount point/);
		rmSync(join(bin, "uname"));
		rmSync(join(bin, "mount"));
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir], { COMPOSE_PROJECT_NAME: "override" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Unset exported COMPOSE_PROJECT_NAME/);
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir], { FAIL_DOWN: "yes" });
		assert.notEqual(result.status, 0);
		assert.equal(readFileSync(join(dir, "data", "database-marker"), "utf8"), "database");
		assert.equal(readFileSync(join(dir, ".env"), "utf8"), originalEnv);
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--dry-run", "--no-start", "--dir", dir]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(join(dir, "data", "database-marker"), "utf8"), "database");
		result = run("install.sh", ["--yes", "--fresh", "--confirm-reset", "--no-start", "--dir", dir], { TEST_PORT: "2525" });
		assert.equal(result.status, 0, result.stderr);
		const backup = readdirSync(dir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.startsWith("data.flixer-backup-"))?.name;
		assert.ok(backup);
		assert.equal(readFileSync(join(dir, backup, "database-marker"), "utf8"), "database");
		assert.deepEqual(readdirSync(join(dir, "data")), []);
		assert.equal(readFileSync(join(dir, "media", "movie"), "utf8"), "media");
		assert.match(readFileSync(join(dir, ".env"), "utf8"), /^COMPOSE_PROJECT_NAME=flixer-reset-[a-z0-9-]+$/m);
		assert.match(readFileSync(join(dir, ".env"), "utf8"), /^HTTP_PORT=2525$/m);
		assert.match(readFileSync(log, "utf8"), /compose -f .* --profile \* down/);
		assert.ok(!readdirSync(dir).some((name) => name.startsWith(".flixer-reset-compose.")));
		if (spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0) {
			const config = spawnSync("docker", ["compose", "config", "--format", "json"], {
				cwd: dir, encoding: "utf8", env: { ...process.env, MEILISEARCH_STORAGE: "meilisearch-data" },
			});
			assert.equal(config.status, 0, config.stderr);
			const resolved = JSON.parse(config.stdout);
			assert.match(resolved.volumes["flixer-secrets"].name, /^flixer-reset-.*_flixer-secrets$/);
			assert.ok(!("meilisearch-data" in resolved.volumes));
			assert.equal(resolved.services.meilisearch.volumes.find((volume) => volume.target === "/meili_data").source, join(dir, "data", "meilisearch"));
			assert.equal(resolved.services.postgres.volumes.find((volume) => volume.target === "/var/lib/postgresql/data").source, join(dir, "data", "database"));
		}

		if (spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0) {
			writeFileSync(join(dir, "data", "second-marker"), "second");
			const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
			const command = ["bash", join(root, "install.sh"), "--no-start", "--no-ai", "--dir", dir].map(quote).join(" ");
			const interactive = (input) => spawnSync("script", ["-q", "-e", "-c", command, "/dev/null"], { encoding: "utf8", env, input });
			result = interactive("\nfresh\nn\n");
			assert.notEqual(result.status, 0);
			assert.match(result.stdout, /not confirmed/);
			assert.equal(readFileSync(join(dir, "data", "second-marker"), "utf8"), "second");
			result = interactive("\nfresh\ny\n\nn\n");
			assert.equal(result.status, 0, result.stdout + result.stderr);
			const backups = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("data.flixer-backup-"));
			assert.equal(backups.length, 2);
			assert.ok(backups.some((entry) => readdirSync(join(dir, entry.name)).includes("second-marker")));
			assert.equal(readFileSync(join(dir, "media", "movie"), "utf8"), "media");
		}
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
