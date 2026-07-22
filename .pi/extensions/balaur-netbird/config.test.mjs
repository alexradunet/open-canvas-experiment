import test from "node:test";
import assert from "node:assert/strict";
import { parseNetbirdConfig, readNetbirdConfig, resolveGroupGid } from "./config.mjs";

function stat({ uid = 0, gid = 77, mode = 0o100640, symlink = false, file = true } = {}) {
  return {
    uid, gid, mode, dev: 1, ino: 2,
    isSymbolicLink: () => symlink,
    isFile: () => file,
  };
}

test("config parser accepts only one token plus comments and blanks", () => {
  assert.deepEqual(parseNetbirdConfig("# managed manually\n\nNETBIRD_API_TOKEN=opaque-value\n"), { token: "opaque-value" });
});

for (const [name, content] of [
  ["unknown", "OTHER=value"],
  ["duplicate", "NETBIRD_API_TOKEN=a\nNETBIRD_API_TOKEN=b"],
  ["export", "export NETBIRD_API_TOKEN=a"],
  ["empty", "NETBIRD_API_TOKEN="],
  ["shell expansion", "NETBIRD_API_TOKEN=$(steal-secret)"],
  ["quoted", "NETBIRD_API_TOKEN=\"opaque-value\""],
]) {
  test(`config parser rejects ${name} syntax without exposing content`, () => {
    assert.throws(() => parseNetbirdConfig(content), (error) => {
      assert.doesNotMatch(error.message, /opaque-value|=a|=b/);
      return true;
    });
  });
}

test("config reader validates injected metadata and group resolution", async () => {
  let resolved = 0;
  const fs = {
    lstat: async () => stat(),
    readFile: async () => "NETBIRD_API_TOKEN=opaque-value\n",
  };
  const config = await readNetbirdConfig({ fs, resolveGroup: async () => { resolved += 1; return 77; } });
  assert.equal(config.token, "opaque-value");
  assert.equal(resolved, 1);
});

test("config reader uses the secure open path and closes its handle", async () => {
  let closed = 0;
  const fs = {
    lstat: async () => stat(),
    open: async () => ({
      stat: async () => stat(),
      readFile: async () => "NETBIRD_API_TOKEN=opaque-value\n",
      close: async () => { closed += 1; },
    }),
  };
  assert.equal((await readNetbirdConfig({ fs, expectedGid: 77 })).token, "opaque-value");
  assert.equal(closed, 1);
});

test("config reader rejects an inode swap and closes its handle", async () => {
  let closed = 0;
  const fs = {
    lstat: async () => stat(),
    open: async () => ({
      stat: async () => ({ ...stat(), ino: 3 }),
      readFile: async () => "NETBIRD_API_TOKEN=do-not-leak\n",
      close: async () => { closed += 1; },
    }),
  };
  await assert.rejects(readNetbirdConfig({ fs, expectedGid: 77 }), /changed while opening/);
  assert.equal(closed, 1);
});

test("config reader rejects symlinks, wrong ownership, and wrong mode", async () => {
  for (const metadata of [stat({ symlink: true }), stat({ uid: 1 }), stat({ gid: 78 }), stat({ mode: 0o100600 })]) {
    const fs = { lstat: async () => metadata, readFile: async () => "NETBIRD_API_TOKEN=do-not-leak" };
    await assert.rejects(readNetbirdConfig({ fs, expectedGid: 77 }), (error) => {
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    });
  }
});

test("group resolver uses an injected group file", async () => {
  const fs = { readFile: async () => "root:x:0:\nbalaur-secrets:x:177:balaur\n" };
  assert.equal(await resolveGroupGid("balaur-secrets", { fs }), 177);
});
