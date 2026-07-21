#!/usr/bin/env node
// Headless Chrome verification driver for the Balaur canvas app (CDP over WebSocket).
// Dependency-free: uses Node's global WebSocket and fetch. See ../SKILL.md.
//
//   node browser-check.mjs smoke [url] [--profile dir] [--offline] [--width N] [--height N] [--screenshot dir]
//   node browser-check.mjs eval  [url] <expression> [--wait expr] [--profile dir]
//   node browser-check.mjs shot  [url] <file.png> [--selector css] [--profile dir]
import { spawn, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_URL = "http://localhost:4173/";

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile" || a === "--wait" || a === "--selector" || a === "--width" || a === "--height" || a === "--screenshot") {
      args.flags[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) {
      args.flags[a.slice(2)] = true;
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function findChrome() {
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { execSync(`command -v ${bin}`, { stdio: "ignore" }); return bin; } catch {}
  }
  return null;
}

export class BrowserSession {
  constructor({ url = DEFAULT_URL, profile = null, width = 1440, height = 900 } = {}) {
    this.url = url;
    this.width = width;
    this.height = height;
    this.profile = profile || mkdtempSync(join(tmpdir(), "balaur-check-"));
    this.ownProfile = !profile;
    this.consoleErrors = [];
    this.failedRequests = [];
    this._id = 0;
    this._pending = new Map();
  }

  async start() {
    const bin = findChrome();
    if (!bin) throw new Error("No Chrome/Chromium binary found on PATH");
    const port = 9200 + Math.floor(Math.random() * 700);
    this.chrome = spawn(bin, [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      `--user-data-dir=${this.profile}`,
      `--window-size=${this.width},${this.height}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ], { stdio: "ignore" });
    // Poll until the DevTools endpoint answers.
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        const tab = tabs.find(t => t.type === "page");
        if (tab) { this.wsUrl = tab.webSocketDebuggerUrl; break; }
      } catch {}
    }
    if (!this.wsUrl) throw new Error("Chrome DevTools endpoint did not come up");
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.method === "Runtime.exceptionThrown") {
        const d = data.params.exceptionDetails;
        this.consoleErrors.push(`${d.text}: ${d.exception?.description?.split("\n")[0] ?? ""} (${d.url?.split("/").pop() ?? ""}:${d.lineNumber})`);
      }
      if (data.method === "Runtime.consoleAPICalled" && data.params.type === "error") {
        this.consoleErrors.push(data.params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300));
      }
      if (data.method === "Network.loadingFailed" && !data.params.canceled) {
        this.failedRequests.push(data.params.requestId);
      }
      if (data.id && this._pending.has(data.id)) { this._pending.get(data.id)(data); this._pending.delete(data.id); }
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    return this;
  }

  send(method, params = {}) {
    return new Promise(res => {
      const id = ++this._id;
      this._pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  }

  async navigate(url = this.url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", 15000);
  }

  async waitFor(expression, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await this.evaluate(`!!(${expression})`)) return true; } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async reload() {
    await this.send("Page.reload");
    await this.waitFor("document.readyState === 'complete'", 15000);
  }

  async mouse(x, y, type, clickCount = 1) {
    await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount });
  }

  async click(x, y) {
    await this.mouse(x, y, "mousePressed", 1);
    await this.mouse(x, y, "mouseReleased", 1);
  }

  async dblclick(x, y) {
    await this.mouse(x, y, "mousePressed", 1);
    await this.mouse(x, y, "mouseReleased", 1);
    await new Promise(r => setTimeout(r, 90));
    await this.mouse(x, y, "mousePressed", 2);
    await this.mouse(x, y, "mouseReleased", 2);
  }

  async screenshot(file, selector = null) {
    const params = { format: "png" };
    if (selector) {
      const box = await this.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.getBoundingClientRect().toJSON() : null;
      })()`);
      if (box) params.clip = { ...box, scale: 1 };
    }
    const res = await this.send("Page.captureScreenshot", params);
    writeFileSync(file, Buffer.from(res.result.data, "base64"));
    return file;
  }

  async setOffline(offline) {
    await this.send("Network.emulateNetworkConditions", offline
      ? { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
      : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  async close() {
    try { this.ws?.close(); } catch {}
    if (this.chrome) {
      this.chrome.kill();
      await new Promise(r => setTimeout(r, 400));
    }
    if (this.ownProfile) {
      try { rmSync(this.profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Shared probes
// ---------------------------------------------------------------------------

// Center of a fully visible non-group card content area, or null.
const PROBE_VISIBLE_CARD = `(() => {
  const c = document.getElementById("canvas").getBoundingClientRect();
  for (const el of document.querySelectorAll('.canvas-node:not(.group-node) .node-content')) {
    const r = el.getBoundingClientRect();
    if (r.left > c.left + 8 && r.top > c.top + 8 && r.right < c.right - 8 && r.bottom < c.bottom - 8 && r.width > 40 && r.height > 30)
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return null;
})()`;

// A viewport point over empty canvas background (no card, no toolbar), or null.
const PROBE_BACKGROUND_POINT = `(() => {
  const c = document.getElementById("canvas").getBoundingClientRect();
  for (let y = c.top + 30; y < c.bottom - 20; y += 24) {
    for (let x = c.left + 30; x < c.right - 20; x += 24) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (el.closest(".canvas-node") || el.closest(".canvas-tools") || el.closest(".zoom-tools") || el.closest(".minimap")) continue;
      if (el === document.getElementById("canvas") || el === document.getElementById("world") || el === document.getElementById("nodes"))
        return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
})()`;

// Structural JSON Canvas 1.0 check of the live document (no module import needed).
const PROBE_IS_CANVAS = `(() => {
  const doc = window.orbitCanvas.getDocument();
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return false;
  const types = new Set(["text", "file", "link", "group"]);
  const ids = new Set(doc.nodes.map(n => n.id));
  if (new Set(doc.edges.map(e => e.id)).size !== doc.edges.length) return false;
  return doc.nodes.every(n => n.id && types.has(n.type)) &&
    doc.edges.every(e => e.id && ids.has(e.fromNode) && ids.has(e.toNode));
})()`;

// ---------------------------------------------------------------------------
// smoke subcommand: the baseline suite from AGENTS.md §13, automated.
// ---------------------------------------------------------------------------

async function smoke(url, flags) {
  const results = [];
  const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); };
  const session = new BrowserSession({
    url,
    profile: flags.profile ? resolve(flags.profile) : null,
    width: Number(flags.width) || 1440,
    height: Number(flags.height) || 900,
  });
  await session.start();
  try {
    await session.navigate();
    await session.waitFor("window.orbitCanvas && document.querySelectorAll('.canvas-node').length > 0", 15000);

    // 1. Boot: no uncaught errors, no failed same-origin assets.
    const failedUrls = [];
    for (const id of session.failedRequests) failedUrls.push(id);
    record("boot: no uncaught console errors", session.consoleErrors.length === 0, session.consoleErrors.slice(0, 3).join(" | "));
    record("boot: no failed asset requests", failedUrls.length === 0, failedUrls.slice(0, 3).join(" | "));

    // 2. Every document node rendered as a card.
    const counts = await session.evaluate(`({ dom: document.querySelectorAll('.canvas-node').length, doc: window.orbitCanvas.getDocument().nodes.length })`);
    record("render: DOM cards match document nodes", counts.dom === counts.doc && counts.doc > 0, `${counts.dom}/${counts.doc}`);

    // 3. Canonical file index came up (in-memory index over the vault; no SQLite in canonical v1).
    try {
      await session.waitFor(`!document.getElementById("lifeIndexStatus").textContent.includes("Preparing")`, 12000);
      const status = await session.evaluate(`document.getElementById("lifeIndexStatus").textContent.trim()`);
      record("index: canonical files indexed", /Files\b/.test(status) && /\d+ indexed/.test(status) && !/unavailable|read-only/i.test(status), status);
    } catch {
      record("index: canonical files indexed", false, await session.evaluate(`document.getElementById("lifeIndexStatus").textContent.trim()`).catch(() => "unreadable"));
    }

    // 4. Clicking a card selects it and opens the inspector.
    const cardPoint = await session.evaluate(PROBE_VISIBLE_CARD);
    if (cardPoint) {
      await session.click(cardPoint.x, cardPoint.y);
      await new Promise(r => setTimeout(r, 300));
      const sel = await session.evaluate(`(() => {
        const node = document.querySelector('.canvas-node.selected');
        const other = document.querySelector('.canvas-node:not(.selected):not(.group-node)');
        const bearing = node?.querySelector('.selection-bearing');
        const bStyle = bearing ? getComputedStyle(bearing) : null;
        const bracket = bearing?.querySelector('i');
        const bracketBg = bracket ? getComputedStyle(bracket).backgroundImage : '';
        // No connection dots may ride along on a selected card.
        const handles = node?.querySelector('.connection-handles');
        const hStyle = handles ? getComputedStyle(handles) : null;
        return {
          selected: !!node,
          inspector: document.querySelector('.app-shell')?.classList.contains('inspector-open') ?? false,
          bearingVisible: !!bStyle && bStyle.display !== 'none',
          hasBrackets: /gradient/.test(bracketBg),
          borderChangesOnSelect: !!node && !!other && getComputedStyle(node).borderTopColor !== getComputedStyle(other).borderTopColor,
          handlesHiddenOnSelect: !!hStyle && (hStyle.opacity === '0' || hStyle.display === 'none'),
        };
      })()`);
      record("select: card selected + inspector open", sel.selected && sel.inspector);
      record("select: corner-bracket frame, no circles", sel.bearingVisible && sel.hasBrackets && sel.borderChangesOnSelect && sel.handlesHiddenOnSelect, `frame:${sel.bearingVisible} brackets:${sel.hasBrackets} border:${sel.borderChangesOnSelect} handlesHidden:${sel.handlesHiddenOnSelect}`);
      if (flags.screenshot) {
        const directory = resolve(flags.screenshot);
        mkdirSync(directory, { recursive: true });
        const file = join(directory, "selected-card.png");
        await session.screenshot(file, ".canvas-node.selected");
        record("select: screenshot captured", true, file);
      }

      // 5. Double-clicking inside a card must NOT create a card.
      const before = await session.evaluate("window.orbitCanvas.getDocument().nodes.length");
      await session.dblclick(cardPoint.x, cardPoint.y);
      await new Promise(r => setTimeout(r, 500));
      const after = await session.evaluate("window.orbitCanvas.getDocument().nodes.length");
      record("create: dblclick inside card creates nothing", after === before, `${before} -> ${after}`);

      // 6. Note tool: clicking inside a card must NOT create a card.
      await session.evaluate(`document.querySelector('.tool[data-tool="note"]').click()`);
      await session.click(cardPoint.x, cardPoint.y);
      await new Promise(r => setTimeout(r, 400));
      const afterTool = await session.evaluate("window.orbitCanvas.getDocument().nodes.length");
      record("create: note tool on card creates nothing", afterTool === after, `${after} -> ${afterTool}`);
      await session.evaluate(`document.querySelector('.tool[data-tool="select"]').click()`);
    } else {
      record("select: found a visible card", false, "no fully visible card in viewport");
    }

    // 7. Double-clicking empty background still creates a note.
    const bgPoint = await session.evaluate(PROBE_BACKGROUND_POINT);
    if (bgPoint) {
      const before = await session.evaluate("window.orbitCanvas.getDocument().nodes.length");
      await session.dblclick(bgPoint.x, bgPoint.y);
      await new Promise(r => setTimeout(r, 500));
      const info = await session.evaluate(`(() => {
        const nodes = window.orbitCanvas.getDocument().nodes;
        const last = nodes[nodes.length - 1];
        return { count: nodes.length, lastText: last?.text ?? "" };
      })()`);
      record("create: dblclick on background creates a note", info.count === before + 1 && info.lastText.includes("New thought"), `${before} -> ${info.count}`);
    } else {
      record("create: found a background point", false, "viewport fully covered");
    }

    // 8. Live document stays valid JSON Canvas 1.0.
    record("export: document is valid JSON Canvas", await session.evaluate(PROBE_IS_CANVAS));

    // 9. Controlled reload preserves the workspace (same profile).
    const titleBefore = await session.evaluate("window.orbitCanvas.getWorkspace().canvases[window.orbitCanvas.getWorkspace().rootId].title");
    const nodesBefore = await session.evaluate("window.orbitCanvas.getDocument().nodes.length");
    await session.reload();
    await session.waitFor("window.orbitCanvas && document.querySelectorAll('.canvas-node').length > 0", 15000);
    await new Promise(r => setTimeout(r, 800));
    const titleAfter = await session.evaluate("window.orbitCanvas.getWorkspace().canvases[window.orbitCanvas.getWorkspace().rootId].title");
    const nodesAfter = await session.evaluate("window.orbitCanvas.getDocument().nodes.length");
    record("persist: reload keeps title and node count", titleBefore === titleAfter && nodesBefore === nodesAfter, `${nodesBefore} -> ${nodesAfter}`);

    // 10. Offline reload renders the shell from the Service Worker cache.
    if (flags.offline) {
      await session.setOffline(true);
      await session.reload();
      await new Promise(r => setTimeout(r, 1500));
      const shellUp = await session.evaluate("!!document.querySelector('.canvas') && !!window.orbitCanvas").catch(() => false);
      record("offline: shell renders from cache", shellUp === true);
      await session.setOffline(false);
    }
  } finally {
    await session.close();
  }

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  }
  console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed}/${results.length} checks FAILED.`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(3));
const command = process.argv[2] || "smoke";
const url = args.positional[0] && /^https?:\/\//.test(args.positional[0]) ? args.positional[0] : DEFAULT_URL;

try {
  if (command === "smoke") {
    process.exit(await smoke(url, args.flags));
  } else if (command === "eval") {
    const expression = args.positional.find(a => a !== url) ?? args.positional[0];
    if (!expression) throw new Error("Usage: browser-check.mjs eval [url] <expression> [--wait expr]");
    const session = new BrowserSession({ url, profile: args.flags.profile ? resolve(args.flags.profile) : null });
    await session.start();
    try {
      await session.navigate();
      if (args.flags.wait) await session.waitFor(args.flags.wait, 15000);
      console.log(JSON.stringify(await session.evaluate(expression), null, 2));
      if (session.consoleErrors.length) console.error("console errors:", session.consoleErrors);
    } finally { await session.close(); }
  } else if (command === "shot") {
    const file = args.positional.find(a => a !== url && a.endsWith(".png")) ?? "shot.png";
    const session = new BrowserSession({ url, profile: args.flags.profile ? resolve(args.flags.profile) : null });
    await session.start();
    try {
      await session.navigate();
      await session.waitFor("window.orbitCanvas && document.querySelectorAll('.canvas-node').length > 0", 15000);
      await new Promise(r => setTimeout(r, 600));
      console.log("wrote", await session.screenshot(file, args.flags.selector ?? null));
    } finally { await session.close(); }
  } else {
    console.error("Unknown command. Use: smoke | eval | shot");
    process.exit(2);
  }
} catch (error) {
  console.error("browser-check failed:", error.message);
  process.exit(1);
}
