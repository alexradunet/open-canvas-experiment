// Phase 6 tests: legacy task migration (plan §16).
// Run: node --test storage/phase6.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryVault } from "./memory-vault.js";
import { MemoryIndex } from "./memory-index.js";
import { LifeIndexer } from "./life-indexer.js";
import { FileTaskRepository } from "./task-repository.js";
import { parseTask } from "./entity-codec.js";
import {
  parseTaskMarker, extractMarkerBody, migrateLegacyTask, migrateLegacyTasks,
} from "./task-migration.js";

const INST = "2026-07-21T18:00:00.000Z";
const NOW = INST;

function setup() {
  const vault = new MemoryVault();
  const index = new MemoryIndex();
  const idToPath = new Map([["canvas-root", "canvases/root.canvas"]]);
  const pathToId = new Map([["canvases/root.canvas", "canvas-root"]]);
  const canvasPathFromId = (id) => idToPath.get(id) || null;
  const indexer = new LifeIndexer({ vault, index, canvasIdFromPath: (p) => pathToId.get(p) });
  const repo = new FileTaskRepository({ vault, index, indexer, canvasPathFromId, now: () => NOW });
  return { vault, index, indexer, repo, canvasPathFromId };
}

async function seedLegacyCanvas(vault) {
  const doc = {
    nodes: [
      { id: "marker-1", type: "text", x: 10, y: 20, width: 300, height: 150, color: "3", text: "<!-- orbit:task task-a1b2c3 -->\n# Finish review\nSome context." },
      { id: "note-1", type: "text", x: 0, y: 0, width: 100, height: 100, text: "# Note" },
    ],
    edges: [{ id: "e1", fromNode: "note-1", toNode: "marker-1" }],
  };
  await vault.write("canvases/root.canvas", JSON.stringify(doc, null, 2) + "\n");
}

const legacyTask = {
  id: "task-a1b2c3", title: "Finish review", status: "next", priority: 1,
  scheduledOn: "2026-07-22", dueOn: null, completedAt: null, estimateMinutes: 45,
  recurrence: null, createdAt: INST, updatedAt: INST,
  body: "# Finish review\nSome context.",
  canvasId: "canvas-root", nodeId: "marker-1",
};

test("parseTaskMarker extracts the id and rejects non-markers", () => {
  assert.equal(parseTaskMarker("<!-- orbit:task task-a1b2c3 -->\n# Hi"), "task-a1b2c3");
  assert.equal(parseTaskMarker("<!--orbit:task  task-x9 -->"), "task-x9");
  assert.equal(parseTaskMarker("# No marker here"), null);
  assert.equal(parseTaskMarker(""), null);
});

test("extractMarkerBody strips the marker line and trims", () => {
  assert.equal(extractMarkerBody("<!-- orbit:task task-x -->\n# Title\nBody."), "# Title\nBody.");
  assert.equal(extractMarkerBody("# Title only"), "# Title only");
});

test("migrateLegacyTask creates a canonical file and replaces the marker node in place", async () => {
  const { repo, vault, index, indexer, canvasPathFromId } = setup();
  await seedLegacyCanvas(vault);
  const result = await migrateLegacyTask({ repo, vault, indexer, canvasPathFromId, task: legacyTask });

  assert.equal(result.id, "task-a1b2c3");
  assert.deepEqual(result.mismatches, [], "fields must round-trip without mismatch");
  assert.match(result.path, /^tasks\/finish-review--a1b2c3\.md$/);

  // Canonical file carries the operational state and body.
  const parsed = parseTask(await vault.read(result.path));
  assert.equal(parsed.title, "Finish review");
  assert.equal(parsed.status, "next");
  assert.equal(parsed.priority, 1);
  assert.equal(parsed.scheduledOn, "2026-07-22");
  assert.equal(parsed.estimateMinutes, 45);
  assert.equal(parsed.body, "# Finish review\nSome context.");

  // The marker node became a file node, preserving id/geometry/color.
  const doc = JSON.parse(await vault.read("canvases/root.canvas"));
  const node = doc.nodes.find((n) => n.id === "marker-1");
  assert.equal(node.type, "file");
  assert.equal(node.file, result.path);
  assert.equal(node.text, undefined);
  assert.equal(node.x, 10);
  assert.equal(node.y, 20);
  assert.equal(node.width, 300);
  assert.equal(node.height, 150);
  assert.equal(node.color, "3");

  // The edge reconnected because the node id was preserved.
  assert.ok(doc.edges.some((e) => e.id === "e1" && e.fromNode === "note-1" && e.toNode === "marker-1"));
});

test("migration records the task and its placement in the index", async () => {
  const { repo, vault, index, indexer, canvasPathFromId } = setup();
  await seedLegacyCanvas(vault);
  await migrateLegacyTask({ repo, vault, indexer, canvasPathFromId, task: legacyTask });
  assert.equal(index.taskById("task-a1b2c3").title, "Finish review");
  const placements = index.placementsForEntity("task-a1b2c3");
  assert.equal(placements.length, 1);
  assert.equal(placements[0].canvasId, "canvas-root");
  assert.equal(placements[0].nodeId, "marker-1");
});

test("a completed legacy task keeps its completed-at through migration", async () => {
  const { repo, vault, indexer, canvasPathFromId } = setup();
  await seedLegacyCanvas(vault);
  const done = { ...legacyTask, status: "done", completedAt: INST };
  const result = await migrateLegacyTask({ repo, vault, indexer, canvasPathFromId, task: done });
  const parsed = parseTask(await vault.read(result.path));
  assert.equal(parsed.status, "done");
  assert.equal(parsed.completedAt, INST);
});

test("migrateLegacyTasks migrates a batch and reconciles counts", async () => {
  const { repo, vault, index, indexer, canvasPathFromId } = setup();
  const doc = {
    nodes: [
      { id: "m1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "<!-- orbit:task task-aaa111 -->\n# One" },
      { id: "m2", type: "text", x: 0, y: 120, width: 200, height: 100, text: "<!-- orbit:task task-bbb222 -->\n# Two" },
    ],
    edges: [],
  };
  await vault.write("canvases/root.canvas", JSON.stringify(doc, null, 2) + "\n");
  const tasks = [
    { id: "task-aaa111", title: "One", status: "next", body: "# One", canvasId: "canvas-root", nodeId: "m1", createdAt: INST, updatedAt: INST },
    { id: "task-bbb222", title: "Two", status: "done", completedAt: INST, body: "# Two", canvasId: "canvas-root", nodeId: "m2", createdAt: INST, updatedAt: INST },
  ];
  const report = await migrateLegacyTasks({ repo, vault, indexer, canvasPathFromId, tasks });
  assert.deepEqual(report.counts, { input: 2, migrated: 2, failed: 0, fieldMismatches: 0 });
  assert.equal(index.allTasks().length, 2);
  assert.equal(index.taskById("task-bbb222").status, "done");
});

test("migrateLegacyTasks isolates a failing record without aborting the run", async () => {
  const { repo, vault, index, indexer, canvasPathFromId } = setup();
  await seedLegacyCanvas(vault);
  const tasks = [
    legacyTask,
    { id: "task-ghost", title: "Ghost", status: "next", body: "", canvasId: "canvas-missing", nodeId: "nope", createdAt: INST, updatedAt: INST },
  ];
  const report = await migrateLegacyTasks({ repo, vault, indexer, canvasPathFromId, tasks });
  assert.equal(report.counts.input, 2);
  assert.equal(report.counts.migrated, 1);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.failed[0].id, "task-ghost");
  assert.equal(report.failed[0].code, "CANVAS_NOT_FOUND");
  assert.equal(index.taskById("task-a1b2c3").title, "Finish review", "valid task still migrated");
});

test("migration refuses a task with no id", async () => {
  const { repo, vault, indexer, canvasPathFromId } = setup();
  await seedLegacyCanvas(vault);
  await assert.rejects(
    () => migrateLegacyTask({ repo, vault, indexer, canvasPathFromId, task: { ...legacyTask, id: null } }),
    /missing its id/,
  );
});
