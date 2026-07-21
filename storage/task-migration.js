// Legacy task migration (Phase 6, ADR-0001, plan §16).
//
// Converts legacy marker-backed tasks (a `<!-- orbit:task id -->` text node plus
// its operational state) into canonical Markdown task files plus standard
// file-node placements, preserving node geometry, color, and edges. The marker
// node keeps its id, so existing edges reconnect to the new file node unchanged.
//
// This module holds the conversion logic only; it is platform-neutral and tested
// against MemoryVault + MemoryIndex (storage/phase6.test.js). Reading the legacy
// state out of localStorage/SQLite and running this against a real profile is the
// browser-verified execution step.

import { parseTask } from "./entity-codec.js";
import { SchemaError } from "./vault-errors.js";

const MARKER_RE = /<!--\s*orbit:task\s+([^\s>]+)\s*-->/;

// Extract the task id from a legacy marker comment, or null if absent.
export function parseTaskMarker(text) {
  const m = MARKER_RE.exec(String(text ?? ""));
  return m ? m[1] : null;
}

// The portable body of a legacy marker node: the marker line removed, trimmed.
export function extractMarkerBody(text) {
  return String(text ?? "").replace(/<!--\s*orbit:task[^\n]*-->\n?/, "").replace(/^\s+/, "").replace(/\s+$/, "");
}

// Replace one legacy marker text node with a file node pointing at the canonical
// task file, preserving id/geometry/color so edges reconnect (plan §16:
// "file-node replacement preserving geometry and edges").
async function replaceMarkerWithFileNode(vault, indexer, canvasPath, nodeId, filePath) {
  const stat = await vault.stat(canvasPath);
  if (!stat) throw new SchemaError(`Canvas not found: ${canvasPath}`, { code: "CANVAS_NOT_FOUND" });
  const doc = JSON.parse(await vault.read(canvasPath));
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) throw new SchemaError(`Marker node not found: ${nodeId}`, { code: "MARKER_NOT_FOUND" });
  node.type = "file";
  node.file = filePath;
  delete node.text;
  const content = JSON.stringify(doc, null, 2) + "\n";
  await vault.write(canvasPath, content, { expectedHash: stat.hash });
  await indexer.indexFile(canvasPath, content, {});
  await indexer.reindexPlacements();
  return node;
}

// Verify a migrated file parses back to the expected operational fields
// (plan §16: "field-by-field migration verification").
function verifyMigration(parsed, task) {
  const mismatches = [];
  const check = (field, expected) => {
    const actual = parsed[field];
    if ((actual ?? null) !== (expected ?? null)) mismatches.push({ field, expected: expected ?? null, actual: actual ?? null });
  };
  check("title", task.title);
  check("status", task.status || "next");
  check("priority", task.priority ?? null);
  check("scheduledOn", task.scheduledOn || null);
  check("dueOn", task.dueOn || null);
  check("estimateMinutes", task.estimateMinutes ?? null);
  return mismatches;
}

// Migrate one legacy task. Returns { id, path, nodeId, mismatches }.
export async function migrateLegacyTask({ repo, vault, indexer, canvasPathFromId, task }) {
  if (!task?.id) throw new SchemaError("Legacy task is missing its id", { code: "TASK_MISSING_ID" });
  const canvasPath = canvasPathFromId(task.canvasId);
  if (!canvasPath) throw new SchemaError(`No canvas path for id: ${task.canvasId}`, { code: "CANVAS_NOT_FOUND" });

  // 1. Write the canonical file (reusing the legacy id as the stable orbit-id).
  const { path } = await repo.createTask({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    scheduledOn: task.scheduledOn,
    dueOn: task.dueOn,
    completedAt: task.completedAt,
    estimateMinutes: task.estimateMinutes,
    recurrence: task.recurrence,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    body: task.body ?? "",
  });

  // 2. Replace the marker node in-place (becomes the placement).
  await replaceMarkerWithFileNode(vault, indexer, canvasPath, task.nodeId, path);

  // 3. Verify the round-trip.
  const parsed = parseTask(await vault.read(path));
  const mismatches = verifyMigration(parsed, task);
  return { id: task.id, path, nodeId: task.nodeId, mismatches };
}

// Migrate a batch of legacy tasks, isolating per-task failures so one bad record
// cannot abort the run (plan §16: "migration diagnostics and retry"). Returns a
// reconciliation report.
export async function migrateLegacyTasks(opts) {
  const { tasks = [] } = opts;
  const migrated = [];
  const failed = [];
  for (const task of tasks) {
    try {
      migrated.push(await migrateLegacyTask({ ...opts, task }));
    } catch (error) {
      failed.push({ id: task?.id ?? null, code: error.code || "MIGRATION_ERROR", message: error.message });
    }
  }
  return {
    migrated,
    failed,
    counts: {
      input: tasks.length,
      migrated: migrated.length,
      failed: failed.length,
      fieldMismatches: migrated.reduce((n, m) => n + m.mismatches.length, 0),
    },
  };
}
