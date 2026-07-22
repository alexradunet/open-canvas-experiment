import test from "node:test";
import assert from "node:assert/strict";
import { formatProjection, presentInspect, summarizePeers } from "./presenters.mjs";

test("peer summary reports bounded aggregate counts", () => {
  assert.deepEqual(summarizePeers([{ connected: true }, { connected: false }, {}]), {
    total: 3, connected: 1, offline: 2,
  });
});

test("presenter bounds item count, line count, line width, and formatted output", () => {
  const peers = Array.from({ length: 100 }, (_, index) => ({
    id: `peer-${index}`,
    name: `peer-${index}-${"x".repeat(500)}`,
    ip: "100.64.0.1",
    connected: index % 2 === 0,
    headers: { authorization: "must-not-render" },
  }));
  const projection = presentInspect("peers", peers, { maxItems: 5, maxLines: 4, maxLineChars: 80 });
  assert.ok(projection.lines.length <= 4);
  assert.ok(projection.lines.every((line) => line.length <= 80));
  assert.doesNotMatch(formatProjection(projection, 200), /must-not-render|authorization/i);
  assert.ok(formatProjection(projection, 200).length <= 200);
});

test("overview presenter emits summaries rather than raw objects", () => {
  const projection = presentInspect("overview", {
    peers: [{ connected: true }], groups: [{ id: "g" }], policies: [], networks: [], routes: [],
    posture_checks: [], dns: { nameserver_groups: [] },
  });
  assert.match(projection.summary, /1\/1 peers online/);
  assert.ok(projection.lines.some((line) => line === "Groups: 1"));
});
