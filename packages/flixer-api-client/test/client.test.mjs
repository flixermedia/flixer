import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";
import { createFlixerApiClient } from "../dist/client.js";

function createTestClient() {
  const requests = [];
  const transport = axios.create({
    baseURL: "/api",
    adapter: async (config) => {
      requests.push(config);
      return {
        config,
        data: { ok: true },
        headers: {},
        status: 200,
        statusText: "OK",
      };
    },
  });
  return { client: createFlixerApiClient(transport), requests };
}

test("generated operations expose typed endpoint functions", async () => {
  const { client, requests } = createTestClient();
  await client.authControllerLogin({ username: "alice", password: "secret" });
  assert.equal(requests[0].url, "/auth/login");
  assert.equal(requests[0].method, "post");
});

test("dispatch preserves body, query, timeout, and encoded path parameters", async () => {
  const { client, requests } = createTestClient();
  await client.post("/auth/login", { username: "alice", password: "secret" }, { timeout: 1234 });
  await client.get("/chat/conversations/group%2Fone/messages", {
    params: { limit: 25 },
  });

  assert.equal(requests[0].timeout, 1234);
  assert.deepEqual(JSON.parse(requests[0].data), { username: "alice", password: "secret" });
  assert.equal(requests[1].url, "/chat/conversations/group%2Fone/messages");
  assert.deepEqual(requests[1].params, { limit: 25 });
});

test("scheduled task endpoints are available through generated route dispatch", async () => {
  const { client, requests } = createTestClient();
  await client.get("/admin/scheduled-tasks");
  await client.put("/admin/scheduled-tasks/scan-libraries", {
    enabled: true,
    cron: "0 */12 * * *",
  });
  await client.post("/admin/scheduled-tasks/scan-libraries/run");
  await client.post("/admin/scheduled-tasks/scan-libraries/stop");

  assert.equal(requests[0].url, "/admin/scheduled-tasks");
  assert.equal(requests[1].url, "/admin/scheduled-tasks/scan-libraries");
  assert.equal(requests[2].url, "/admin/scheduled-tasks/scan-libraries/run");
  assert.equal(requests[3].url, "/admin/scheduled-tasks/scan-libraries/stop");
});

test("rejects paths that are not in the generated API", async () => {
  const { client } = createTestClient();
  await assert.rejects(client.get("/not-a-generated-route"), /No generated Flixer API operation matches/);
});
