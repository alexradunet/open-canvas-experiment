/** Balaur-owned visible Herdr worker bridge. */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { HerdrClient, EXPECTED_PROTOCOL } from "./herdr-client.js";
import { parseRoleFile, roleNameFromFilename, type RoleConfig } from "./role-parser.js";
import { assertPinnedAgent, buildWorkerEnv, closePane, createPane, listAgents, promptAgent, readAgent, removeRolePromptFile, reportPaneMetadata, requestCloseConfirmation, startAgent, waitForAgent, waitForInteractiveReady, waitForSessionIdentity } from "./pane-manager.js";
import { waitForFinalizedSessionResult, waitForPiSessionReference } from "./session-collector.js";
import { createHandleStore, createHandle, deserializeStore, listHandles, reconcileHandles, serializeStore, type WorkerHandle } from "./handle-store.js";

const ActionSchema = StringEnum(["start", "list", "status", "wait", "read", "prompt", "collect", "close"] as const);
const BOUNDED_STRING = (description: string, maxLength = 16000) => Type.String({ description, minLength: 1, maxLength });
const HerdrAgentParams = Type.Object({
  action: ActionSchema,
  role: Type.Optional(BOUNDED_STRING("Role name from .pi/agents/*.md", 64)),
  handle: Type.Optional(BOUNDED_STRING("Worker handle ID", 64)),
  prompt: Type.Optional(BOUNDED_STRING("Prompt text", 16000)),
  timeout_ms: Type.Optional(Type.Integer({ minimum: 3000, maximum: 300000 })),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
}, { additionalProperties: false });

const handleMap = new Map<string, WorkerHandle>();
const MAX_ERROR_BYTES = 4000;

export default function (pi: ExtensionAPI) {
  if (process.env.BALAUR_WORKER === "1" || !HerdrClient.isInHerdrPane()) return;
  const herdrEnv = HerdrClient.getHerdrEnv();
  if (!herdrEnv) return;
  const makeClient = () => new HerdrClient({ socketPath: herdrEnv.socketPath, timeoutMs: 10000 });

  pi.on("session_start", async (_event, ctx) => {
    handleMap.clear();
    for (const entry of ctx?.sessionManager?.getBranch?.() || []) {
      if (entry?.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === "herdr_agent" && entry.message.details?.store) {
        for (const handle of listHandles(deserializeStore(entry.message.details.store))) handleMap.set(handle.handleId, handle);
      }
    }
    if (!handleMap.size) return;
    try {
      const store = createStore();
      const reconciled = reconcileHandles(store, await listAgents(makeClient()));
      setStore(reconciled);
    } catch {
      // Herdr is unavailable: retain persisted identities without rebinding them.
    }
  });

  function createStore() {
    const store = createHandleStore();
    for (const handle of handleMap.values()) store.handles[handle.handleId] = handle;
    return store;
  }
  function setStore(store: ReturnType<typeof createHandleStore>) {
    handleMap.clear();
    for (const handle of listHandles(store)) handleMap.set(handle.handleId, handle);
  }
  function details(extra: Record<string, unknown> = {}) {
    const store = createStore();
    return { store: serializeStore(store), handles: listHandles(store), ...extra };
  }
  function bounded(text: string) {
    const value = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
    return value.truncated ? `${value.content}\n\n[Output truncated: ${value.outputLines}/${value.totalLines} lines, ${formatSize(value.outputBytes)}/${formatSize(value.totalBytes)}. Full evidence is in details.]` : value.content;
  }
  function boundedError(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    return Buffer.byteLength(text) > MAX_ERROR_BYTES ? `${text.slice(0, MAX_ERROR_BYTES)}… [error truncated]` : text;
  }

  async function discoverRoles(cwd: string) {
    const roles = new Map<string, { role: RoleConfig; filePath: string }>();
    const errors = new Map<string, string>();
    const agentsDir = resolve(cwd, ".pi", "agents");
    if (!existsSync(agentsDir)) return { roles, errors };
    for (const entry of await readdir(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const filePath = join(agentsDir, entry);
      let name = entry.slice(0, -3);
      try {
        name = roleNameFromFilename(entry);
        roles.set(name, { role: parseRoleFile(await readFile(filePath, "utf8"), filePath), filePath });
      } catch (error) {
        errors.set(name, boundedError(error));
      }
    }
    return { roles, errors };
  }
  function requireHandle(id: string | undefined) {
    if (!id) throw new Error("handle is required for this action");
    const handle = handleMap.get(id);
    if (!handle) throw new Error(`Unknown handle: ${id}`);
    return handle;
  }
  async function pinned(handle: WorkerHandle, signal?: AbortSignal) { return assertPinnedAgent(makeClient(), handle, signal); }

  pi.registerTool({
    name: "herdr_agent", label: "Herdr Agent",
    description: "Start and control visible interactive Pi workers in Herdr panes. read is diagnostic; collect is the authoritative finalized Pi JSONL result.",
    promptSnippet: "Start and control visible Herdr Pi workers",
    promptGuidelines: ["Use herdr_agent for visible Herdr workers.", "Use herdr_agent collect, not read, for the authoritative finalized result."],
    parameters: HerdrAgentParams,
    async execute(_id, params, signal, _update, ctx) {
      if (!HerdrClient.isInHerdrPane()) throw new Error("herdr_agent is only available inside a Herdr pane");
      try {
        switch (params.action) {
          case "start": return await start(params, ctx, signal);
          case "list": return { content: [{ type: "text", text: bounded(renderList()) }], details: details() };
          case "status": return await status(params, signal);
          case "wait": return await wait(params, signal);
          case "read": return await read(params, signal);
          case "prompt": return await prompt(params, signal);
          case "collect": return await collect(params, signal);
          case "close": return await close(params, ctx, signal);
        }
      } catch (error) {
        throw new Error(boundedError(error));
      }
    },
    renderCall(args, theme) {
      const suffix = args.role || args.handle || "";
      return new Text(theme.fg("toolTitle", theme.bold("herdr_agent ")) + theme.fg("accent", `${args.action} ${suffix}`.trim()), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      const handles = (result.details as any)?.handles || [];
      const extra = expanded && handles.length ? `\n${handles.map((h: WorkerHandle) => `${h.handleId} ${h.status} ${h.role} @ ${h.paneId}`).join("\n")}` : "";
      return new Text(text + extra, 0, 0);
    },
  });

  async function start(params: any, ctx: any, signal?: AbortSignal) {
    if (!params.role) throw new Error("role is required for start");
    const catalog = await discoverRoles(ctx.cwd);
    const entry = catalog.roles.get(params.role);
    if (!entry) {
      const parseError = catalog.errors.get(params.role);
      if (parseError) throw new Error(parseError);
      throw new Error(`Unknown role '${params.role}'. Available: ${[...catalog.roles.keys()].join(", ") || "none"}`);
    }
    const client = makeClient();
    const ping = await client.ping(signal);
    if (ping.protocol !== EXPECTED_PROTOCOL || !ping.capabilities.live_handoff) throw new Error(`Herdr protocol/capability mismatch (protocol ${ping.protocol})`);
    const pane = await createPane(client, { currentPaneId: herdrEnv.paneId, direction: "right", ratio: 0.5, cwd: ctx.cwd, env: buildWorkerEnv() }, signal);
    const started = await startAgent(client, { paneId: pane.pane_id, agentName: `${params.role}-${Date.now().toString(36)}`, role: entry.role, cwd: ctx.cwd }, signal);
    let identity;
    try {
      await waitForInteractiveReady(client, started.agent_name, 60000, signal);
      identity = await waitForSessionIdentity(client, started.agent_name, 10000, signal);
    } finally { await removeRolePromptFile(started.promptFile); }
    const handle = { ...createHandle({ paneId: pane.pane_id, role: params.role, workspaceId: pane.workspace_id, worktreePath: ctx.cwd, ...identity }), status: "ready" as const };
    handleMap.set(handle.handleId, handle);
    await reportPaneMetadata(client, pane.pane_id, { role: params.role, bridge: "herdr-agent", state: "ready" }, signal);
    return { content: [{ type: "text", text: bounded(`Started ${params.role}: handle ${handle.handleId}, pane ${pane.pane_id}, session ${handle.sessionKind}:${handle.sessionValue}.`) }], details: details({ handle: handle.handleId, session: { kind: handle.sessionKind, value: handle.sessionValue } }) };
  }
  function renderList() { return handleMap.size ? [...handleMap.values()].map((h) => `${h.handleId}: ${h.role} @ ${h.paneId} [${h.status}]`).join("\n") : "No active workers."; }
  async function status(params: any, signal?: AbortSignal) {
    const handle = requireHandle(params.handle);
    try { const agent = await pinned(handle, signal); handle.status = agent.agent_status === "done" ? "done" : agent.agent_status === "idle" ? "idle" : "working"; } catch { if (handle.status !== "replaced") handle.status = "missing"; }
    return { content: [{ type: "text", text: bounded(`${handle.handleId}: ${handle.status}\nagent=${handle.agentName}\npane=${handle.paneId}\nsession=${handle.sessionKind}:${handle.sessionValue}`) }], details: details({ handle: handle.handleId }) };
  }
  async function wait(params: any, signal?: AbortSignal) {
    const handle = requireHandle(params.handle); await pinned(handle, signal);
    const result = await waitForAgent(makeClient(), { target: handle.agentName, until: ["idle", "done"], timeoutMs: params.timeout_ms || 120000 }, signal);
    if (result.timedOut) return { content: [{ type: "text", text: bounded(`Worker ${handle.handleId} timed out; it was not killed.`) }], details: details({ handle: handle.handleId, timedOut: true }) };
    handle.status = result.status === "done" ? "done" : "idle";
    return { content: [{ type: "text", text: bounded(`Worker ${handle.handleId} reached ${result.status}.`) }], details: details({ handle: handle.handleId }) };
  }
  async function read(params: any, signal?: AbortSignal) {
    const handle = requireHandle(params.handle); await pinned(handle, signal);
    const output = await readAgent(makeClient(), { target: handle.agentName, lines: params.lines || 200 }, signal);
    return { content: [{ type: "text", text: bounded(`[Diagnostic terminal output; use collect for the finalized result]\n${output.text}`) }], details: details({ handle: handle.handleId, rawOutput: output.text, truncated: output.truncated }) };
  }
  async function prompt(params: any, signal?: AbortSignal) {
    if (!params.prompt) throw new Error("prompt is required for prompt");
    const handle = requireHandle(params.handle); await pinned(handle, signal);
    await promptAgent(makeClient(), { target: handle.agentName, text: params.prompt }, signal); handle.status = "working";
    return { content: [{ type: "text", text: `Prompted ${handle.handleId}.` }], details: details({ handle: handle.handleId }) };
  }
  async function collect(params: any, signal?: AbortSignal) {
    const handle = requireHandle(params.handle); await pinned(handle, signal);
    const filePath = await waitForPiSessionReference({ kind: handle.sessionKind, value: handle.sessionValue }, 10000, signal);
    const result = await waitForFinalizedSessionResult(filePath, 10000, signal);
    if (result.stopReason === "incomplete") return { content: [{ type: "text", text: "Worker session has no finalized result yet." }], details: details({ handle: handle.handleId, stopReason: result.stopReason }) };
    return { content: [{ type: "text", text: bounded(result.text) }], details: details({ handle: handle.handleId, sessionPath: filePath, stopReason: result.stopReason, toolCalls: result.toolCalls, usage: result.usage, fullText: result.text }) };
  }
  async function close(params: any, ctx: any, signal?: AbortSignal) {
    const handle = requireHandle(params.handle); await pinned(handle, signal);
    if (!await requestCloseConfirmation(ctx, handle)) return { content: [{ type: "text", text: "Close cancelled by user." }], details: details({ handle: handle.handleId, cancelled: true }) };
    await pinned(handle, signal); // close race: confirm does not authorize a replacement
    await closePane(makeClient(), handle.paneId, signal); handleMap.delete(handle.handleId);
    return { content: [{ type: "text", text: `Closed ${handle.handleId}.` }], details: details({ closed: handle.handleId }) };
  }
}
