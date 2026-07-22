import test from "node:test";
import assert from "node:assert/strict";
import { boundedPreview, createMutationService } from "./mutations.mjs";

function fakeClient(overrides = {}) {
  const empty = {
    list: async () => [], get: async () => ({}), create: async () => ({}),
    replace: async () => ({}), delete: async () => null, update: async () => ({}),
  };
  return {
    groups: { ...empty }, policies: { ...empty }, postureChecks: { ...empty }, routes: { ...empty },
    networks: { ...empty }, nameserverGroups: { ...empty },
    dnsSettings: { get: async () => ({ disabled_management_groups: [] }), replace: async () => ({}) },
    peers: { ...empty },
    ...overrides,
  };
}

test("non-TUI mutation fails before any API request", async () => {
  let requests = 0;
  const endpoint = new Proxy({}, { get: () => async () => { requests += 1; } });
  const service = createMutationService({ client: fakeClient({ networks: endpoint }) });
  await assert.rejects(service.execute({ operation: "network.create", body: { name: "safe" } }, {
    mode: "rpc",
    confirm: async () => true,
  }), /interactive TUI/);
  assert.equal(requests, 0);
});

test("cancellation performs reads but zero writes", async () => {
  let reads = 0;
  let writes = 0;
  const groups = {
    get: async () => { reads += 1; return { id: "g1", name: "safe", peers: [], resources: [] }; },
    delete: async () => { writes += 1; },
  };
  const service = createMutationService({ client: fakeClient({ groups }) });
  const result = await service.execute({ operation: "group.delete", id: "g1" }, {
    mode: "tui",
    confirm: async () => false,
  });
  assert.equal(result.cancelled, true);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});

test("successful confirmation performs exactly one write", async () => {
  let reads = 0;
  let writes = 0;
  let confirmations = 0;
  const current = { id: "g1", name: "old", peers: [], resources: [] };
  const groups = {
    get: async () => { reads += 1; return current; },
    replace: async (id, body) => { writes += 1; return { id, ...body }; },
  };
  const service = createMutationService({ client: fakeClient({ groups }) });
  const result = await service.execute({ operation: "group.replace", id: "g1", body: { name: "new", peers: [] } }, {
    mode: "tui",
    confirm: async (preview) => { confirmations += 1; assert.match(preview.before, /old/); return true; },
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 2);
  assert.equal(confirmations, 1);
  assert.equal(writes, 1);
});

test("stale remote state aborts after confirmation and before write", async () => {
  let reads = 0;
  let writes = 0;
  let confirmations = 0;
  const groups = {
    get: async () => ({ id: "g1", name: ++reads === 1 ? "old" : "changed" }),
    replace: async () => { writes += 1; },
  };
  const service = createMutationService({ client: fakeClient({ groups }) });
  await assert.rejects(service.execute({ operation: "group.replace", id: "g1", body: { name: "new" } }, {
    mode: "tui",
    confirm: async () => { confirmations += 1; return true; },
  }), /remote state changed/);
  assert.equal(confirmations, 1);
  assert.equal(writes, 0);
});

test("DNS settings replacement uses the id-free read and write path", async () => {
  let reads = 0;
  let writes = 0;
  const current = { disabled_management_groups: [] };
  const dnsSettings = {
    get: async (...args) => {
      reads += 1;
      assert.equal(args.length, 1);
      return current;
    },
    replace: async (body) => {
      writes += 1;
      assert.deepEqual(body, { disabled_management_groups: ["group-1"] });
      return body;
    },
  };
  const service = createMutationService({ client: fakeClient({ dnsSettings }) });
  const result = await service.execute({
    operation: "dns_settings.replace",
    body: { disabled_management_groups: ["group-1"] },
  }, {
    mode: "tui",
    confirm: async () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test("one mutation lock rejects concurrent mutation", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const service = createMutationService({ client: fakeClient() });
  const first = service.execute({ operation: "network.create", body: { name: "one" } }, {
    mode: "tui",
    confirm: async () => waiting,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.isLocked(), true);
  await assert.rejects(service.execute({ operation: "network.create", body: { name: "two" } }, {
    mode: "tui",
    confirm: async () => false,
  }), /already in progress/);
  release(false);
  await first;
  assert.equal(service.isLocked(), false);
});

test("bounded previews redact likely secret fields and enforce length", () => {
  const token = "token-that-must-not-appear";
  const preview = boundedPreview({ authorization: `Token ${token}`, nested: { api_key: token }, value: "x".repeat(500) }, 160);
  assert.ok(preview.length <= 160);
  assert.doesNotMatch(preview, new RegExp(token));
});
