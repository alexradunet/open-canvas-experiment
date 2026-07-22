import test from "node:test";
import assert from "node:assert/strict";
import { MUTATION_OPERATIONS, validateInspectParams, validateMutationInput } from "./contracts.mjs";

test("inspect contract is closed and permits supported detail IDs", () => {
  assert.deepEqual(validateInspectParams({ view: "groups", id: "group-1" }), { view: "groups", id: "group-1" });
  assert.throws(() => validateInspectParams({ view: "overview", id: "x" }), /does not accept/);
  assert.throws(() => validateInspectParams({ view: "peers", url: "https:\/\/evil.invalid" }), /unknown property/);
  assert.doesNotThrow(() => validateInspectParams({ view: "events" }));
  assert.throws(() => validateInspectParams({ view: "billing" }), /unknown inspect view/);
});

test("mutation operation allowlist has no peer writes or arbitrary endpoint", () => {
  assert.ok(!MUTATION_OPERATIONS.some((operation) => operation.startsWith("peer.")));
  assert.ok(!MUTATION_OPERATIONS.includes("peer.delete"));
  assert.ok(!MUTATION_OPERATIONS.some((operation) => operation.includes("request")));
  assert.throws(() => validateMutationInput({ operation: "peer.delete", id: "p1" }), /unknown mutation/);
  assert.throws(() => validateMutationInput({ operation: "request", method: "DELETE", path: "/api/peers/p1" }), /unknown property|unknown mutation/);
});

test("resource contracts reject unknown fields and require meaningful group, policy, and network bodies", () => {
  assert.throws(() => validateMutationInput({ operation: "group.create", body: { peers: [] } }), /name/);
  assert.throws(() => validateMutationInput({ operation: "network.create", body: { name: "" } }), /name/);
  assert.throws(() => validateMutationInput({ operation: "policy.create", body: { name: "p", enabled: true } }), /rules/);
  assert.throws(() => validateMutationInput({ operation: "network.create", body: { name: "n", endpoint: "evil" } }), /unknown property/);
  assert.doesNotThrow(() => validateMutationInput({ operation: "policy.create", body: { name: "p", enabled: true, rules: [] } }));
});

test("contracts recursively reject dangerous prototype keys", () => {
  const body = JSON.parse('{"name":"g","resources":[{"__proto__":{"polluted":true}}]}');
  assert.throws(() => validateMutationInput({ operation: "group.create", body }), /dangerous property/);
  assert.equal({}.polluted, undefined);
});

test("DNS settings replacement accepts no id and IDs reject traversal", () => {
  assert.doesNotThrow(() => validateMutationInput({
    operation: "dns_settings.replace",
    body: { disabled_management_groups: [] },
  }));
  assert.throws(() => validateMutationInput({ operation: "group.delete", id: ".." }), /id is invalid/);
});
