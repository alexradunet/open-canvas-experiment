#!/usr/bin/env node
/** Strict opt-in live smoke. Leaves only a successful worker pane open. */
import { resolve, join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { HerdrClient, EXPECTED_PROTOCOL } from "../herdr-client.js";
import { parseRoleFile, roleNameFromFilename } from "../role-parser.js";
import { buildWorkerEnv, captureAgentIdentity, createPane, getAgent, promptAgent, removeRolePromptFile, reportPaneMetadata, startAgent, waitForAgent, waitForInteractiveReady, waitForSessionIdentity } from "../pane-manager.js";
import { waitForFinalizedSessionResult, waitForPiSessionReference } from "../session-collector.js";

async function role(cwd) {
  const filePath = join(cwd, ".pi", "agents", "executor.md");
  if (!existsSync(filePath)) throw new Error(`missing smoke role: ${filePath}`);
  return { name: roleNameFromFilename("executor.md"), role: parseRoleFile(await readFile(filePath, "utf8"), filePath) };
}
async function main() {
  if (!HerdrClient.isInHerdrPane()) throw new Error("not inside a Herdr pane");
  const env = HerdrClient.getHerdrEnv();
  const cwd = process.cwd();
  const client = new HerdrClient({ socketPath: env.socketPath, timeoutMs: 10000 });
  const ping = await client.ping();
  if (ping.protocol !== EXPECTED_PROTOCOL || !ping.capabilities.live_handoff) throw new Error(`protocol/capability mismatch: ${ping.protocol}`);
  const selected = await role(cwd);
  console.log(`Herdr ${ping.version} protocol ${ping.protocol}; role ${selected.name}`);
  const pane = await createPane(client, { currentPaneId: env.paneId, direction: "right", ratio: 0.5, cwd, env: buildWorkerEnv() });
  console.log(`Created visible pane ${pane.pane_id}`);
  const started = await startAgent(client, { paneId: pane.pane_id, agentName: `smoke-${Date.now().toString(36)}`, role: selected.role, cwd });
  let identity;
  try {
    await waitForInteractiveReady(client, started.agent_name, 60000);
    identity = await waitForSessionIdentity(client, started.agent_name, 10000);
  } finally { await removeRolePromptFile(started.promptFile); }
  await reportPaneMetadata(client, pane.pane_id, { role: selected.name, bridge: "herdr-agent", state: "smoke" });
  await promptAgent(client, { target: started.agent_name, text: "Reply with exactly: SMOKE_TEST_OK" });
  const waited = await waitForAgent(client, { target: started.agent_name, until: ["idle", "done"], timeoutMs: 120000 });
  if (waited.timedOut) throw new Error(`worker timed out; pane ${pane.pane_id} remains open`);
  const filePath = await waitForPiSessionReference({ kind: identity.sessionKind, value: identity.sessionValue }, 10000);
  const result = await waitForFinalizedSessionResult(filePath, 10000);
  if (result.stopReason !== "stop") throw new Error(`unexpected stop reason: ${result.stopReason}`);
  if (result.text !== "SMOKE_TEST_OK") throw new Error(`unexpected result text: ${JSON.stringify(result.text)}`);
  console.log(`SUCCESS pane=${pane.pane_id} agent=${started.agent_name} session=${identity.sessionKind}:${identity.sessionValue} result=${result.text}`);
  console.log(`Pane ${pane.pane_id} remains OPEN for inspection.`);
}
main().catch((error) => { console.error(`SMOKE FAILED: ${error.message}`); process.exitCode = 1; });
