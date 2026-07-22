import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

let createStaticServer;
try {
  ({ createStaticServer } = await import("./server.mjs"));
} catch {}

test("exports a static server factory", () => {
  assert.equal(typeof createStaticServer, "function");
});

async function withServer(run, options = {}) {
  const parent = await mkdtemp(join(tmpdir(), "balaur-server-"));
  const root = join(parent, "public");
  await mkdir(root);
  await writeFile(join(root, "index.html"), "<!doctype html><title>Balaur test</title>");
  await writeFile(join(root, "app.js"), "export const ready = true;\n");
  await writeFile(join(parent, "secret.txt"), "not public");

  const server = createStaticServer({ root, ...options });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("serves the root index with an HTML content type", async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html;/);
    assert.match(await response.text(), /Balaur test/);
  });
});

test("serves modules with a JavaScript content type", async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/app.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/javascript;/);
  });
});

test("injects the reload client only in live-reload mode", async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/`);
    assert.match(await response.text(), /new EventSource\("\/.balaur\/live-reload"\)/);
  }, { liveReload: true });

  await withServer(async origin => {
    const response = await fetch(`${origin}/`);
    assert.doesNotMatch(await response.text(), /EventSource/);
  });
});

test("returns 404 for missing files and does not expose parent files", async () => {
  await withServer(async origin => {
    assert.equal((await fetch(`${origin}/missing.txt`)).status, 404);
    const traversal = await fetch(`${origin}/%2e%2e%2fsecret.txt`);
    assert.ok(traversal.status === 400 || traversal.status === 404);
    assert.notEqual(await traversal.text(), "not public");
  });
});
