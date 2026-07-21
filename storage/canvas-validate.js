// Strict JSON Canvas 1.0 structural validator shared by storage and import paths.

const NODE_TYPES = new Set(["text", "file", "link", "group"]);
const SIDES = new Set(["top", "right", "bottom", "left"]);
const ENDS = new Set(["none", "arrow"]);
const COLORS = (value) => value === undefined || (typeof value === "string" && (/^[1-6]$/.test(value) || /^#[0-9a-f]{6}$/i.test(value)));
const integer = (value) => typeof value === "number" && Number.isInteger(value);
const string = (value) => typeof value === "string";

function onlyKnown(value, keys) {
  return Object.keys(value).every((key) => keys.has(key));
}

export function isCanvas(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges) || !onlyKnown(data, new Set(["nodes", "edges"]))) return false;
  const ids = new Set();
  for (const node of data.nodes) {
    if (!node || typeof node !== "object") return false;
    const common = new Set(["id", "type", "x", "y", "width", "height", "color"]);
    const extras = node.type === "text" ? ["text"] : node.type === "file" ? ["file", "subpath"] : node.type === "link" ? ["url"] : node.type === "group" ? ["label", "background", "backgroundStyle"] : [];
    if (!onlyKnown(node, new Set([...common, ...extras]))) return false;
    if (!string(node.id) || node.id.length === 0 || ids.has(node.id) || !NODE_TYPES.has(node.type)) return false;
    if (![node.x, node.y, node.width, node.height].every(integer) || node.width <= 0 || node.height <= 0 || !COLORS(node.color)) return false;
    if (node.type === "text" && !string(node.text)) return false;
    if (node.type === "file" && (!string(node.file) || node.file.length === 0 || (node.subpath !== undefined && (!string(node.subpath) || !node.subpath.startsWith("#"))))) return false;
    if (node.type === "link" && (!string(node.url) || node.url.length === 0)) return false;
    if (node.type === "group") {
      if (node.label !== undefined && !string(node.label)) return false;
      if (node.background !== undefined && !string(node.background)) return false;
      if (node.backgroundStyle !== undefined && !new Set(["cover", "ratio", "repeat"]).has(node.backgroundStyle)) return false;
    }
    ids.add(node.id);
  }
  for (const edge of data.edges) {
    if (!edge || typeof edge !== "object" || !onlyKnown(edge, new Set(["id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd", "color", "label"]))) return false;
    if (!string(edge.id) || edge.id.length === 0 || ids.has(edge.id) || !string(edge.fromNode) || !string(edge.toNode) || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) return false;
    if (edge.fromSide !== undefined && !SIDES.has(edge.fromSide)) return false;
    if (edge.toSide !== undefined && !SIDES.has(edge.toSide)) return false;
    if (edge.fromEnd !== undefined && !ENDS.has(edge.fromEnd)) return false;
    if (edge.toEnd !== undefined && !ENDS.has(edge.toEnd)) return false;
    if (edge.label !== undefined && !string(edge.label)) return false;
    if (!COLORS(edge.color)) return false;
    ids.add(edge.id);
  }
  return true;
}
