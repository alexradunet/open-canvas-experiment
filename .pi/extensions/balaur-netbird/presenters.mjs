const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_LINES = 120;
const DEFAULT_MAX_LINE_CHARS = 240;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

function clean(value, max = 100) {
  if (value === undefined || value === null) return "-";
  const text = String(value).replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function count(value) {
  return list(value).length;
}

function itemLine(view, item) {
  if (!item || typeof item !== "object") return clean(item);
  const id = clean(item.id, 45);
  const name = clean(item.name ?? item.network_id ?? item.domain ?? item.ip, 80);
  if (view === "peers") {
    return `${item.connected ? "online" : "offline"}  ${name}  ${clean(item.ip, 45)}  id=${id}`;
  }
  if (view === "groups") return `${name}  peers=${count(item.peers) || item.peers_count || 0}  id=${id}`;
  if (view === "policies") return `${item.enabled ? "enabled" : "disabled"}  ${name}  rules=${count(item.rules)}  id=${id}`;
  if (view === "networks") return `${name}  routers=${count(item.routers) || item.routing_peers_count || 0}  resources=${count(item.resources)}  id=${id}`;
  if (view === "routes") return `${item.enabled ? "enabled" : "disabled"}  ${name}  ${clean(item.network ?? list(item.domains).join(", "), 80)}  id=${id}`;
  if (view === "posture_checks") return `${name}  ${clean(item.description, 100)}  id=${id}`;
  if (view === "dns") return `${item.enabled ? "enabled" : "disabled"}  ${name}  servers=${count(item.nameservers)}  id=${id}`;
  if (view === "events") {
    return `${clean(item.timestamp ?? item.created_at, 35)}  ${clean(item.activity ?? item.action, 90)}  ${clean(item.target_name ?? item.meta?.name, 70)}`;
  }
  return `${name}  id=${id}`;
}

function capLines(lines, { maxLines, maxLineChars }) {
  const capped = lines.slice(0, maxLines).map((line) => clean(line, maxLineChars));
  if (lines.length > maxLines && capped.length > 0) {
    capped[capped.length - 1] = clean(`... ${lines.length - maxLines + 1} more lines`, maxLineChars);
  }
  return capped;
}

export function summarizePeers(peers) {
  const values = list(peers);
  const connected = values.filter((peer) => peer?.connected === true).length;
  return Object.freeze({ total: values.length, connected, offline: values.length - connected });
}

export function presentInspect(view, data, {
  maxItems = DEFAULT_MAX_ITEMS,
  maxLines = DEFAULT_MAX_LINES,
  maxLineChars = DEFAULT_MAX_LINE_CHARS,
} = {}) {
  const safeMaxItems = Math.max(1, Math.min(200, maxItems));
  const options = {
    maxLines: Math.max(1, Math.min(500, maxLines)),
    maxLineChars: Math.max(20, Math.min(1_000, maxLineChars)),
  };
  let title = `NetBird ${view}`;
  let summary = "";
  let lines = [];

  if (view === "overview") {
    const peers = summarizePeers(data?.peers);
    summary = `${peers.connected}/${peers.total} peers online`;
    lines = [
      `Peers: ${peers.total} total, ${peers.connected} online, ${peers.offline} offline`,
      `Groups: ${count(data?.groups)}`,
      `Policies: ${count(data?.policies)}`,
      `Networks: ${count(data?.networks)}`,
      `Routes: ${count(data?.routes)}`,
      `DNS nameserver groups: ${count(data?.dns?.nameserver_groups)}`,
      `Posture checks: ${count(data?.posture_checks)}`,
      `Recent events: ${count(data?.events)}`,
    ];
  } else if (view === "dns" && data && !Array.isArray(data) && (data.settings || data.nameserver_groups)) {
    const disabled = count(data.settings?.disabled_management_groups);
    const values = list(data.nameserver_groups);
    summary = `${values.length} nameserver groups; management disabled for ${disabled} groups`;
    lines = values.slice(0, safeMaxItems).map((item) => itemLine("dns", item));
    if (values.length > safeMaxItems) lines.push(`... ${values.length - safeMaxItems} more items`);
  } else {
    const values = Array.isArray(data) ? data : [data];
    summary = Array.isArray(data) ? `${values.length} items` : "detail";
    lines = values.slice(0, safeMaxItems).map((item) => itemLine(view, item));
    if (values.length > safeMaxItems) lines.push(`... ${values.length - safeMaxItems} more items`);
  }

  return Object.freeze({ title: clean(title, options.maxLineChars), summary: clean(summary, options.maxLineChars), lines: Object.freeze(capLines(lines, options)) });
}

export function formatProjection(projection, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  const lines = [projection.title, projection.summary, ...projection.lines];
  const text = lines.filter(Boolean).join("\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 20))}\n... [truncated]`;
}
