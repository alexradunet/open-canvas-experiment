import { constants as fsConstants } from "node:fs";
import * as defaultFs from "node:fs/promises";

export const NETBIRD_CONFIG_PATH = "/etc/balaur/netbird.env";
export const NETBIRD_SECRET_GROUP = "balaur-secrets";

function configError(message) {
  return new Error(`NetBird configuration error: ${message}`);
}

export function parseNetbirdConfig(text) {
  if (typeof text !== "string") throw configError("invalid file encoding");

  let token;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (/^export(?:\s|$)/.test(line)) throw configError("export syntax is not allowed");

    const separator = line.indexOf("=");
    if (separator < 1) throw configError("invalid assignment");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key !== "NETBIRD_API_TOKEN") throw configError("unknown setting");
    if (token !== undefined) throw configError("duplicate setting");
    if (value === "") throw configError("empty token");
    if (!/^[A-Za-z0-9._~+\/-]+$/.test(value)) {
      throw configError("token contains unsupported syntax");
    }
    token = value;
  }

  if (token === undefined) throw configError("NETBIRD_API_TOKEN is missing");
  return Object.freeze({ token });
}

export async function resolveGroupGid(
  groupName = NETBIRD_SECRET_GROUP,
  { fs = defaultFs, groupFile = "/etc/group" } = {},
) {
  let content;
  try {
    content = await fs.readFile(groupFile, "utf8");
  } catch {
    throw configError("could not resolve the secret group");
  }

  const matches = content.split(/\r?\n/).filter((line) => line.split(":", 1)[0] === groupName);
  if (matches.length !== 1) throw configError("secret group is missing or ambiguous");
  const fields = matches[0].split(":");
  const gid = Number(fields[2]);
  if (!Number.isSafeInteger(gid) || gid < 0) throw configError("secret group has an invalid gid");
  return gid;
}

function assertMetadata(stat, expectedGid) {
  if (typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) {
    throw configError("configuration file must not be a symlink");
  }
  if (stat.uid !== 0 || stat.gid !== expectedGid || (stat.mode & 0o7777) !== 0o640) {
    throw configError("configuration file must be root:balaur-secrets mode 0640");
  }
  if (typeof stat.isFile === "function" && !stat.isFile()) {
    throw configError("configuration path is not a regular file");
  }
}

export async function readNetbirdConfig({
  path = NETBIRD_CONFIG_PATH,
  fs = defaultFs,
  expectedGid,
  resolveGroup = () => resolveGroupGid(NETBIRD_SECRET_GROUP, { fs }),
} = {}) {
  const gid = expectedGid ?? await resolveGroup();
  if (!Number.isSafeInteger(gid) || gid < 0) throw configError("secret group has an invalid gid");

  let before;
  try {
    before = await fs.lstat(path);
  } catch {
    throw configError("configuration file is unavailable");
  }
  assertMetadata(before, gid);

  // O_NOFOLLOW closes the lstat/read symlink race on supported Unix systems.
  if (typeof fs.open === "function") {
    let handle;
    try {
      handle = await fs.open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const during = await handle.stat();
      assertMetadata(during, gid);
      if (before.dev !== undefined && during.dev !== undefined
          && (before.dev !== during.dev || before.ino !== during.ino)) {
        throw configError("configuration file changed while opening");
      }
      return parseNetbirdConfig(await handle.readFile("utf8"));
    } catch (error) {
      if (error?.message?.startsWith("NetBird configuration error:")) throw error;
      throw configError("configuration file could not be read safely");
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  try {
    return parseNetbirdConfig(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error?.message?.startsWith("NetBird configuration error:")) throw error;
    throw configError("configuration file could not be read");
  }
}
