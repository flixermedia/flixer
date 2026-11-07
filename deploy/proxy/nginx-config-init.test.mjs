import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { load } from "js-yaml";

for (const composeFile of ["docker-compose.yml", "docker-compose.dev.yml"]) {
	const compose = load(readFileSync(new URL(`../../${composeFile}`, import.meta.url), "utf8"));
	const command = compose.services["nginx-config-init"].command[0];

	function setup(t, template, existing) {
		const directory = mkdtempSync(join(tmpdir(), "flixer-nginx-"));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const source = join(directory, "template.conf");
		const data = join(directory, "data");
		const target = join(data, "nginx", "nginx.conf");
		if (template !== undefined) writeFileSync(source, template);
		if (existing !== undefined) {
			mkdirSync(join(data, "nginx"), { recursive: true });
			writeFileSync(target, existing);
		}
		const script = command.replaceAll("/opt/resources/nginx.conf", source).replaceAll("/data/nginx", join(data, "nginx"));
		return { result: spawnSync("sh", ["-c", script], { encoding: "utf8" }), target };
	}

	test(`${composeFile}: refreshes the configuration from the image`, (t) => {
		const { result, target } = setup(t, "bundled config", "old config");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(target, "utf8"), "bundled config");
		assert.equal(statSync(target).mode & 0o777, 0o644);
	});

	test(`${composeFile}: accepts a manually supplied configuration when the template is missing`, (t) => {
		const { result, target } = setup(t, undefined, "manual config");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /using existing/);
		assert.equal(readFileSync(target, "utf8"), "manual config");
		assert.equal(statSync(target).mode & 0o777, 0o644);
	});

	test(`${composeFile}: treats an empty template as missing`, (t) => {
		const { result, target } = setup(t, "", "manual config");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /using existing/);
		assert.equal(readFileSync(target, "utf8"), "manual config");
	});

	for (const existing of [undefined, ""]) {
		test(`${composeFile}: reports a missing template and ${existing === "" ? "empty" : "missing"} configuration`, (t) => {
			const { result } = setup(t, undefined, existing);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /Pull a newer Flixer image or place nginx.conf in DATA_DIR\/nginx/);
		});
	}
}
