import { readNetbirdConfig } from "./config.mjs";
import { validateId, validateInspectParams } from "./contracts.mjs";

export const NETBIRD_API_ORIGIN = "https://api.netbird.io";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

export function redactError(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret !== "") message = message.split(secret).join("[REDACTED]");
  }
  message = message
    .replace(/Authorization\s*:\s*(?:Token|Bearer)\s+[^\s,;]+/gi, "Authorization: [REDACTED]")
    .replace(/\b(?:Token|Bearer)\s+[A-Za-z0-9._~+\/-]+/gi, "[REDACTED]");
  return new Error(message || "NetBird request failed");
}

function combineSignals(signal, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("NetBird request timed out")), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function readBoundedText(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("NetBird response exceeded the size limit");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("NetBird response exceeded the size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function createNetbirdClient({
  fetchImpl = globalThis.fetch,
  tokenProvider = () => readNetbirdConfig(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  async function request(method, endpoint, { body, signal } = {}) {
    let token;
    const combined = combineSignals(signal, timeoutMs);
    try {
      const config = await tokenProvider();
      token = config?.token;
      if (typeof token !== "string" || token === "") throw new Error("NetBird token is unavailable");

      // endpoint is supplied only by the closed methods below, never by tool input.
      const url = new URL(endpoint, `${NETBIRD_API_ORIGIN}/`);
      if (url.origin !== NETBIRD_API_ORIGIN) throw new Error("NetBird endpoint origin is invalid");
      const headers = { Accept: "application/json", Authorization: `Token ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(url, {
        method,
        headers,
        redirect: "error",
        signal: combined.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await readBoundedText(response, maxResponseBytes);
      if (!response.ok) throw new Error(`NetBird API request failed with status ${response.status}`);
      if (text.trim() === "") return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("NetBird API returned invalid JSON");
      }
    } catch (error) {
      if (combined.signal.aborted && !signal?.aborted) {
        throw new Error("NetBird request timed out");
      }
      throw redactError(error, [token]);
    } finally {
      combined.cleanup();
    }
  }

  const withId = (base, id) => `${base}/${encodeURIComponent(validateId(id))}`;
  const read = (base) => Object.freeze({
    list: ({ signal } = {}) => request("GET", base, { signal }),
    get: (id, { signal } = {}) => request("GET", withId(base, id), { signal }),
  });
  const mutable = (base) => Object.freeze({
    ...read(base),
    create: (body, { signal } = {}) => request("POST", base, { body, signal }),
    replace: (id, body, { signal } = {}) => request("PUT", withId(base, id), { body, signal }),
    delete: (id, { signal } = {}) => request("DELETE", withId(base, id), { signal }),
  });

  const peers = read("/api/peers");
  const groups = mutable("/api/groups");
  const policies = mutable("/api/policies");
  const postureChecks = mutable("/api/posture-checks");
  const routes = mutable("/api/routes");
  const networks = mutable("/api/networks");
  const nameserverGroups = mutable("/api/dns/nameservers");
  const events = read("/api/events");
  const dnsSettings = Object.freeze({
    get: ({ signal } = {}) => request("GET", "/api/dns/settings", { signal }),
    replace: (body, { signal } = {}) => request("PUT", "/api/dns/settings", { body, signal }),
  });

  async function inspect(input, { signal } = {}) {
    const { view, id } = validateInspectParams(input);
    if (view === "overview") {
      const [peerData, groupData, policyData, networkData, routeData, postureData, settings, nameservers, eventData] = await Promise.all([
        peers.list({ signal }), groups.list({ signal }), policies.list({ signal }), networks.list({ signal }),
        routes.list({ signal }), postureChecks.list({ signal }), dnsSettings.get({ signal }),
        nameserverGroups.list({ signal }), events.list({ signal }),
      ]);
      return {
        peers: peerData, groups: groupData, policies: policyData, networks: networkData,
        routes: routeData, posture_checks: postureData,
        dns: { settings, nameserver_groups: nameservers }, events: eventData,
      };
    }
    if (view === "peers") return id ? peers.get(id, { signal }) : peers.list({ signal });
    if (view === "groups") return id ? groups.get(id, { signal }) : groups.list({ signal });
    if (view === "policies") return id ? policies.get(id, { signal }) : policies.list({ signal });
    if (view === "networks") return id ? networks.get(id, { signal }) : networks.list({ signal });
    if (view === "routes") return id ? routes.get(id, { signal }) : routes.list({ signal });
    if (view === "posture_checks") return id ? postureChecks.get(id, { signal }) : postureChecks.list({ signal });
    if (view === "dns") {
      if (id) return nameserverGroups.get(id, { signal });
      const [settings, nameserver_groups] = await Promise.all([
        dnsSettings.get({ signal }), nameserverGroups.list({ signal }),
      ]);
      return { settings, nameserver_groups };
    }
    if (view === "events") return events.list({ signal });
    throw new Error("NetBird inspect view is unavailable");
  }

  return Object.freeze({
    inspect,
    peers,
    groups,
    policies,
    postureChecks,
    routes,
    networks,
    nameserverGroups,
    dnsSettings,
    events,
  });
}
