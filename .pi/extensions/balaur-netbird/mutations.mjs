import { validateMutationInput } from "./contracts.mjs";

const PREVIEW_MAX_CHARS = 4_000;
const SENSITIVE_KEY = /(?:authorization|token|secret|password|credential|api[_-]?key)/i;

export function stableSerialize(value) {
  const seen = new WeakSet();
  const normalize = (item) => {
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) throw new Error("NetBird state could not be compared safely");
    seen.add(item);
    if (Array.isArray(item)) return item.map(normalize);
    const output = Object.create(null);
    for (const key of Object.keys(item).sort()) output[key] = normalize(item[key]);
    return output;
  };
  return JSON.stringify(normalize(value));
}

function previewValue(value, depth = 0) {
  if (depth > 8) return "[bounded]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 297)}...` : value;
  if (Array.isArray(value)) {
    const values = value.slice(0, 30).map((item) => previewValue(item, depth + 1));
    if (value.length > 30) values.push(`[${value.length - 30} more]`);
    return values;
  }
  if (typeof value === "object") {
    const output = Object.create(null);
    for (const key of Object.keys(value).sort().slice(0, 60)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : previewValue(value[key], depth + 1);
    }
    if (Object.keys(value).length > 60) output._bounded = true;
    return output;
  }
  return String(value);
}

export function boundedPreview(value, maxChars = PREVIEW_MAX_CHARS) {
  const serialized = JSON.stringify(previewValue(value), null, 2) ?? "null";
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, Math.max(0, maxChars - 20))}\n... [truncated]`;
}

function descriptor(client, operation) {
  const table = {
    "group.create": [client.groups, "create", "group"],
    "group.replace": [client.groups, "replace", "group"],
    "group.delete": [client.groups, "delete", "group"],
    "policy.create": [client.policies, "create", "policy"],
    "policy.replace": [client.policies, "replace", "policy"],
    "policy.delete": [client.policies, "delete", "policy"],
    "posture_check.create": [client.postureChecks, "create", "posture check"],
    "posture_check.replace": [client.postureChecks, "replace", "posture check"],
    "posture_check.delete": [client.postureChecks, "delete", "posture check"],
    "route.create": [client.routes, "create", "route"],
    "route.replace": [client.routes, "replace", "route"],
    "route.delete": [client.routes, "delete", "route"],
    "network.create": [client.networks, "create", "network"],
    "network.replace": [client.networks, "replace", "network"],
    "network.delete": [client.networks, "delete", "network"],
    "nameserver_group.create": [client.nameserverGroups, "create", "nameserver group"],
    "nameserver_group.replace": [client.nameserverGroups, "replace", "nameserver group"],
    "nameserver_group.delete": [client.nameserverGroups, "delete", "nameserver group"],
    "dns_settings.replace": [client.dnsSettings, "replace", "DNS settings"],
  };
  const entry = table[operation];
  if (!entry) throw new Error("NetBird mutation operation is unavailable");
  return { api: entry[0], action: entry[1], resourceLabel: entry[2] };
}

function normalizeResult(input, result) {
  const normalized = {
    ok: true,
    operation: input.operation,
    ...(input.id ? { id: input.id } : {}),
  };
  if (input.operation.endsWith(".delete")) return { ...normalized, deleted: true };
  if (result && typeof result === "object" && !Array.isArray(result)) {
    for (const key of ["id", "name", "description", "enabled", "connected"]) {
      const value = result[key];
      if (["string", "boolean", "number"].includes(typeof value)) normalized[key] = value;
    }
  }
  return normalized;
}

export function createMutationService({ client, maxPreviewChars = PREVIEW_MAX_CHARS } = {}) {
  if (!client) throw new TypeError("NetBird client is required");
  let active = false;

  async function execute(input, { mode, confirm, signal } = {}) {
    // This check intentionally precedes validation, token reads, and every client call.
    if (mode !== "tui") throw new Error("NetBird mutations require interactive TUI mode");
    if (active) throw new Error("Another NetBird mutation is already in progress");
    if (typeof confirm !== "function") throw new Error("NetBird mutation confirmation is unavailable");

    const validated = validateMutationInput(input);
    active = true;
    try {
      const { api, action, resourceLabel } = descriptor(client, validated.operation);
      const changesExisting = action === "replace" || action === "delete" || action === "update";
      let current = null;
      let currentSerialized;

      if (changesExisting) {
        current = action === "replace" && validated.operation === "dns_settings.replace"
          ? await api.get({ signal })
          : await api.get(validated.id, { signal });
        currentSerialized = stableSerialize(current);
      }

      const after = action === "delete" ? null : validated.body;
      const preview = Object.freeze({
        operation: validated.operation,
        resource: resourceLabel,
        ...(validated.id ? { id: validated.id } : {}),
        before: boundedPreview(current, maxPreviewChars),
        after: boundedPreview(after, maxPreviewChars),
      });

      if (signal?.aborted) throw new Error("NetBird mutation cancelled");
      const accepted = await confirm(preview);
      if (!accepted) return Object.freeze({ ok: false, cancelled: true, operation: validated.operation });
      if (signal?.aborted) throw new Error("NetBird mutation cancelled");

      // Recheck after confirmation so the approved preview still matches remote state.
      if (changesExisting) {
        const latest = action === "replace" && validated.operation === "dns_settings.replace"
          ? await api.get({ signal })
          : await api.get(validated.id, { signal });
        if (stableSerialize(latest) !== currentSerialized) {
          throw new Error("NetBird mutation aborted because remote state changed; review and confirm again");
        }
      }
      if (signal?.aborted) throw new Error("NetBird mutation cancelled");

      let result;
      if (action === "create") result = await api.create(validated.body, { signal });
      else if (validated.operation === "dns_settings.replace") result = await api.replace(validated.body, { signal });
      else if (action === "replace") result = await api.replace(validated.id, validated.body, { signal });
      else if (action === "update") result = await api.update(validated.id, validated.body, { signal });
      else result = await api.delete(validated.id, { signal });
      return Object.freeze(normalizeResult(validated, result));
    } finally {
      active = false;
    }
  }

  return Object.freeze({ execute, isLocked: () => active });
}
