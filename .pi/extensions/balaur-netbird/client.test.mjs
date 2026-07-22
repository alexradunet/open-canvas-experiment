import test from "node:test";
import assert from "node:assert/strict";
import { createNetbirdClient, NETBIRD_API_ORIGIN } from "./client.mjs";

const TOKEN = "never-print-this-token";
const json = (value, init = {}) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
  ...init,
});

test("client fixes origin, auth scheme, redirect policy, and documented inspect mapping", async () => {
  const calls = [];
  const client = createNetbirdClient({
    tokenProvider: async () => ({ token: TOKEN }),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return json([]);
    },
  });

  await client.inspect({ view: "peers" });
  await client.inspect({ view: "groups", id: "group-1" });
  await client.inspect({ view: "policies" });
  await client.inspect({ view: "networks" });
  await client.inspect({ view: "routes" });
  await client.inspect({ view: "posture_checks" });
  await client.inspect({ view: "dns" });
  await client.inspect({ view: "events" });

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/api/peers", "/api/groups/group-1", "/api/policies", "/api/networks", "/api/routes",
    "/api/posture-checks", "/api/dns/settings", "/api/dns/nameservers", "/api/events",
  ]);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, NETBIRD_API_ORIGIN);
    assert.equal(call.options.headers.Authorization, `Token ${TOKEN}`);
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.method, "GET");
  }
});

test("client exposes the closed documented mutation mappings and no peer delete", async () => {
  const calls = [];
  const client = createNetbirdClient({
    tokenProvider: async () => ({ token: TOKEN }),
    fetchImpl: async (url, options) => { calls.push([new URL(url).pathname, options.method]); return json({ id: "x" }); },
  });
  await client.groups.create({ name: "g" });
  await client.policies.replace("p1", { name: "p" });
  await client.postureChecks.delete("pc1");
  await client.routes.replace("r1", {});
  await client.networks.delete("n1");
  await client.nameserverGroups.create({ name: "dns" });
  await client.dnsSettings.replace({ disabled_management_groups: [] });

  assert.deepEqual(calls, [
    ["/api/groups", "POST"], ["/api/policies/p1", "PUT"], ["/api/posture-checks/pc1", "DELETE"],
    ["/api/routes/r1", "PUT"], ["/api/networks/n1", "DELETE"], ["/api/dns/nameservers", "POST"],
    ["/api/dns/settings", "PUT"],
  ]);
  assert.equal(client.peers.delete, undefined);
  assert.equal(client.peers.update, undefined);
});

test("client rejects traversal IDs before fetch", async () => {
  let calls = 0;
  const client = createNetbirdClient({ tokenProvider: async () => ({ token: TOKEN }), fetchImpl: async () => { calls += 1; return json({}); } });
  assert.throws(() => client.groups.get("../admin"), /id is invalid/);
  assert.equal(calls, 0);
});

test("client bounds JSON responses", async () => {
  const client = createNetbirdClient({
    tokenProvider: async () => ({ token: TOKEN }),
    maxResponseBytes: 10,
    fetchImpl: async () => json({ value: "this is too large" }),
  });
  await assert.rejects(client.peers.list(), /size limit/);
});

test("client errors redact the token", async () => {
  const client = createNetbirdClient({
    tokenProvider: async () => ({ token: TOKEN }),
    fetchImpl: async () => { throw new Error(`transport included ${TOKEN} and Authorization: Token ${TOKEN}`); },
  });
  await assert.rejects(client.peers.list(), (error) => {
    assert.doesNotMatch(error.message, new RegExp(TOKEN));
    assert.match(error.message, /REDACTED/);
    return true;
  });
});
