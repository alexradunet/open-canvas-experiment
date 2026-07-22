import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createNetbirdClient } from "./client.mjs";
import { INSPECT_VIEWS, MUTATION_OPERATIONS } from "./contracts.mjs";
import { openNetbirdDashboard } from "./dashboard.ts";
import { createMutationService } from "./mutations.mjs";
import { formatProjection, presentInspect, summarizePeers } from "./presenters.mjs";

const STATUS_ID = "balaur-netbird";
const STATUS_INTERVAL_MS = 60_000;

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "NetBird operation failed";
  return message.replace(/\b(?:Token|Bearer)\s+\S+/gi, "[REDACTED]").slice(0, 500);
}

export default function balaurNetbirdExtension(pi: ExtensionAPI) {
  const client = createNetbirdClient();
  const mutations = createMutationService({ client });
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let statusAbort: AbortController | undefined;
  let statusGeneration = 0;
  let statusRunGeneration: number | undefined;

  async function localReady(signal?: AbortSignal): Promise<boolean> {
    const result = await pi.exec("netbird", ["status", "--check", "ready"], { signal, timeout: 8_000 });
    return result.code === 0;
  }

  async function doctor(signal?: AbortSignal): Promise<string> {
    const [local, peers] = await Promise.all([localReady(signal), client.peers.list({ signal })]);
    const cloud = summarizePeers(peers);
    return `Local daemon ${local ? "ready" : "not ready"}; Cloud API ready; peers ${cloud.connected}/${cloud.total} online`;
  }

  async function refreshStatus(ctx: ExtensionContext, generation: number): Promise<void> {
    if (statusRunGeneration === generation) return;
    statusRunGeneration = generation;
    const controller = new AbortController();
    statusAbort = controller;
    try {
      const local = await localReady(controller.signal).catch(() => false);
      let cloudText = "cloud unavailable";
      try {
        const peers = summarizePeers(await client.peers.list({ signal: controller.signal }));
        cloudText = `${peers.connected}/${peers.total} cloud peers`;
      } catch {
        // Configuration and transient Cloud failures stay secret-free in the footer.
      }
      if (generation !== statusGeneration || controller.signal.aborted) return;
      const color = local ? "success" : "warning";
      ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg(color, `NetBird ${local ? "ready" : "local down"} · ${cloudText}`));
    } finally {
      if (statusRunGeneration === generation) statusRunGeneration = undefined;
      if (statusAbort === controller) statusAbort = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    if (statusTimer) clearInterval(statusTimer);
    const generation = ++statusGeneration;
    void refreshStatus(ctx, generation);
    statusTimer = setInterval(() => { void refreshStatus(ctx, generation); }, STATUS_INTERVAL_MS);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    statusGeneration += 1;
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = undefined;
    statusAbort?.abort();
    statusAbort = undefined;
    statusRunGeneration = undefined;
    ctx.ui.setStatus(STATUS_ID, undefined);
  });

  pi.registerCommand("netbird", {
    description: "Open the read-only NetBird dashboard, or run /netbird doctor",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === "doctor") {
        try {
          ctx.ui.notify(await doctor(ctx.signal), "info");
        } catch (error) {
          ctx.ui.notify(safeMessage(error), "error");
        }
        return;
      }
      if (command !== "") {
        ctx.ui.notify("Usage: /netbird or /netbird doctor", "warning");
        return;
      }
      try {
        await openNetbirdDashboard(ctx, { client, doctor: () => doctor() });
      } catch (error) {
        ctx.ui.notify(safeMessage(error), "error");
      }
    },
  });

  pi.registerTool({
    name: "netbird_inspect",
    label: "NetBird Inspect",
    description: "Read a bounded NetBird Cloud overview or an allowlisted resource view. Optional id selects a supported detail view.",
    promptSnippet: "Inspect NetBird peers, groups, policies, networks, routes, DNS, posture checks, or recent events",
    promptGuidelines: [
      "Use netbird_inspect for NetBird state instead of shell commands or direct API requests.",
    ],
    parameters: Type.Object({
      view: StringEnum(INSPECT_VIEWS),
      id: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal) {
      try {
        const projection = presentInspect(params.view, await client.inspect(params, { signal }));
        return {
          content: [{ type: "text" as const, text: formatProjection(projection) }],
          details: projection,
        };
      } catch (error) {
        throw new Error(safeMessage(error));
      }
    },
  });

  pi.registerTool({
    name: "netbird_configure",
    label: "NetBird Configure",
    description: "Apply one strictly allowlisted NetBird Cloud mutation in TUI mode after explicit user confirmation and a fresh-state recheck.",
    promptSnippet: "Propose a closed, validated NetBird configuration change that always requires human confirmation",
    promptGuidelines: [
      "Use netbird_configure only for supported NetBird changes; it cannot write peers or run without interactive confirmation.",
    ],
    parameters: Type.Object({
      operation: StringEnum(MUTATION_OPERATIONS),
      id: Type.Optional(Type.String()),
      body: Type.Optional(Type.Unknown()),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") throw new Error("NetBird mutations require interactive TUI mode");
      try {
        const result = await mutations.execute(params, {
          mode: ctx.mode,
          signal,
          confirm: (preview) => ctx.ui.confirm(
            `Confirm NetBird ${preview.operation}`,
            `${preview.resource}${preview.id ? ` ${preview.id}` : ""}\n\nBefore:\n${preview.before}\n\nAfter:\n${preview.after}`,
          ),
        });
        const text = result.cancelled
          ? `Cancelled ${result.operation}; no write was sent.`
          : `Applied ${result.operation}${result.id ? ` to ${result.id}` : ""}.`;
        return { content: [{ type: "text" as const, text }], details: result };
      } catch (error) {
        throw new Error(safeMessage(error));
      }
    },
  });
}
