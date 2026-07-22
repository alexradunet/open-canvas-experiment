const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_BODY_DEPTH = 20;
const MAX_BODY_NODES = 10_000;
const MAX_STRING_LENGTH = 8_192;

export const INSPECT_VIEWS = Object.freeze([
  "overview",
  "peers",
  "groups",
  "policies",
  "networks",
  "routes",
  "dns",
  "posture_checks",
  "events",
]);

export const MUTATION_OPERATIONS = Object.freeze([
  "group.create", "group.replace", "group.delete",
  "policy.create", "policy.replace", "policy.delete",
  "posture_check.create", "posture_check.replace", "posture_check.delete",
  "route.create", "route.replace", "route.delete",
  "network.create", "network.replace", "network.delete",
  "nameserver_group.create", "nameserver_group.replace", "nameserver_group.delete",
  "dns_settings.replace",
]);

const DETAIL_VIEWS = new Set([
  "peers", "groups", "policies", "networks", "routes", "dns", "posture_checks",
]);
const OPERATION_SET = new Set(MUTATION_OPERATIONS);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

const BODY_FIELDS = Object.freeze({
  group: new Set(["name", "peers", "resources"]),
  policy: new Set(["name", "description", "enabled", "source_posture_checks", "rules"]),
  posture_check: new Set(["name", "description", "checks"]),
  route: new Set([
    "description", "network_id", "enabled", "peer", "peer_groups", "network", "domains",
    "metric", "masquerade", "groups", "keep_route", "access_control_groups", "skip_auto_apply",
  ]),
  network: new Set(["name", "description"]),
  nameserver_group: new Set([
    "name", "description", "nameservers", "enabled", "groups", "primary", "domains",
    "search_domains_enabled",
  ]),
  dns_settings: new Set(["disabled_management_groups"]),
});

function contractError(message) {
  return new Error(`NetBird input rejected: ${message}`);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectUnknownProperties(value, allowed, label) {
  if (!isRecord(value)) throw contractError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw contractError(`${label} contains an unknown property`);
  }
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function validateId(id, label = "id") {
  if (typeof id !== "string" || !ID_PATTERN.test(id) || id.includes("..") || id.includes("/")) {
    throw contractError(`${label} is invalid`);
  }
  return id;
}

function validateJsonTree(value) {
  let nodes = 0;
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > MAX_BODY_NODES || depth > MAX_BODY_DEPTH) throw contractError("body is too large");
    if (typeof item === "string") {
      if (item.length > MAX_STRING_LENGTH) throw contractError("body contains an oversized string");
      return;
    }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw contractError("body contains an invalid number");
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (!isRecord(item)) throw contractError("body must contain only JSON values");
    for (const [key, child] of Object.entries(item)) {
      if (DANGEROUS_KEYS.has(key)) throw contractError("body contains a dangerous property");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function requireString(body, key) {
  if (typeof body[key] !== "string" || body[key].trim() === "") {
    throw contractError(`${key} must be a non-empty string`);
  }
}

function requireBoolean(body, key) {
  if (typeof body[key] !== "boolean") throw contractError(`${key} must be a boolean`);
}

function requireArray(body, key) {
  if (!Array.isArray(body[key])) throw contractError(`${key} must be an array`);
}

function validateBody(resource, body) {
  rejectUnknownProperties(body, BODY_FIELDS[resource], "body");
  validateJsonTree(body);

  if (resource === "group") {
    requireString(body, "name");
    if (has(body, "peers")) requireArray(body, "peers");
    if (has(body, "resources")) requireArray(body, "resources");
  } else if (resource === "policy") {
    requireString(body, "name");
    requireBoolean(body, "enabled");
    requireArray(body, "rules");
  } else if (resource === "network") {
    requireString(body, "name");
  } else if (resource === "posture_check") {
    requireString(body, "name");
    requireString(body, "description");
  } else if (resource === "route") {
    requireString(body, "description");
    requireString(body, "network_id");
    requireBoolean(body, "enabled");
    if (!Number.isInteger(body.metric) || body.metric < 1 || body.metric > 9999) {
      throw contractError("metric must be an integer from 1 to 9999");
    }
    requireBoolean(body, "masquerade");
    requireArray(body, "groups");
    requireBoolean(body, "keep_route");
    if ((has(body, "peer") ? 1 : 0) + (has(body, "peer_groups") ? 1 : 0) !== 1) {
      throw contractError("route requires exactly one of peer or peer_groups");
    }
    if ((has(body, "network") ? 1 : 0) + (has(body, "domains") ? 1 : 0) !== 1) {
      throw contractError("route requires exactly one of network or domains");
    }
  } else if (resource === "nameserver_group") {
    requireString(body, "name");
    requireString(body, "description");
    requireArray(body, "nameservers");
    if (body.nameservers.length < 1 || body.nameservers.length > 3) {
      throw contractError("nameservers must contain one to three entries");
    }
    requireBoolean(body, "enabled");
    requireArray(body, "groups");
    requireBoolean(body, "primary");
    requireArray(body, "domains");
    requireBoolean(body, "search_domains_enabled");
  } else if (resource === "dns_settings") {
    requireArray(body, "disabled_management_groups");
  }
  return body;
}

export function validateInspectParams(input) {
  rejectUnknownProperties(input, new Set(["view", "id"]), "inspect parameters");
  if (!INSPECT_VIEWS.includes(input.view)) throw contractError("unknown inspect view");
  if (has(input, "id")) {
    if (!DETAIL_VIEWS.has(input.view)) throw contractError("this view does not accept an id");
    validateId(input.id);
  }
  return Object.freeze({ view: input.view, ...(has(input, "id") ? { id: input.id } : {}) });
}

export function validateMutationInput(input) {
  rejectUnknownProperties(input, new Set(["operation", "id", "body"]), "mutation parameters");
  if (!OPERATION_SET.has(input.operation)) throw contractError("unknown mutation operation");

  const [resource, action] = input.operation.split(".");
  const needsId = resource !== "dns_settings"
    && (action === "replace" || action === "delete" || action === "update");
  const needsBody = action === "create" || action === "replace" || action === "update";

  if (needsId) validateId(input.id);
  else if (has(input, "id")) throw contractError("this operation does not accept an id");

  if (needsBody) {
    if (!has(input, "body")) throw contractError("this operation requires a body");
    validateBody(resource, input.body);
  } else if (has(input, "body")) {
    throw contractError("this operation does not accept a body");
  }

  return Object.freeze({
    operation: input.operation,
    ...(needsId ? { id: input.id } : {}),
    ...(needsBody ? { body: input.body } : {}),
  });
}
