import { createReadStream, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIME_TYPES = new Map([
  [".canvas", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

const LIVE_RELOAD_PATH = "/.balaur/live-reload";
const LIVE_RELOAD_SCRIPT = `<script>
  (() => {
    const events = new EventSource("${LIVE_RELOAD_PATH}");
    events.addEventListener("reload", () => location.reload());
  })();
</script>`;

function sendText(response, status, message) {
  response.writeHead(status, {
    "Cache-Control": "no-cache",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

function isIgnoredWatchPath(filename) {
  if (!filename) return false;
  return filename.split(/[\\/]/).some(part => [".git", ".pi", "node_modules"].includes(part));
}

export function createStaticServer({ root = process.cwd(), liveReload = false } = {}) {
  const publicRoot = resolve(root);
  const reloadClients = new Set();
  let reloadTimer;
  let watcher;

  const server = createServer(async (request, response) => {
    if (liveReload && request.method === "GET" && request.url === LIVE_RELOAD_PATH) {
      response.writeHead(200, {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream",
      });
      response.write(": connected\n\n");
      reloadClients.add(response);
      request.on("close", () => reloadClients.delete(response));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(response, 405, "Method not allowed\n");
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      sendText(response, 400, "Bad request\n");
      return;
    }

    let filePath = resolve(publicRoot, `.${pathname}`);
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
      sendText(response, 400, "Bad request\n");
      return;
    }

    try {
      let fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = resolve(filePath, "index.html");
        fileStat = await stat(filePath);
      }
      if (!fileStat.isFile()) throw new Error("Not a file");

      const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream";
      if (liveReload && contentType.startsWith("text/html")) {
        const source = await readFile(filePath, "utf8");
        const body = source.includes("</body>")
          ? source.replace("</body>", `${LIVE_RELOAD_SCRIPT}\n</body>`)
          : `${source}\n${LIVE_RELOAD_SCRIPT}`;
        response.writeHead(200, {
          "Cache-Control": "no-cache",
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": contentType,
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": fileStat.size,
        "Content-Type": contentType,
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      if (error?.code === "EACCES") {
        sendText(response, 403, "Forbidden\n");
        return;
      }
      sendText(response, 404, "Not found\n");
    }
  });

  if (liveReload) {
    watcher = watch(publicRoot, { recursive: true }, (_eventType, filename) => {
      if (isIgnoredWatchPath(filename)) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        for (const client of reloadClients) client.write("event: reload\ndata: changed\n\n");
      }, 75);
    });
    watcher.on("error", error => console.error(`Live reload watcher failed: ${error.message}`));
    server.on("close", () => {
      clearTimeout(reloadTimer);
      watcher?.close();
      for (const client of reloadClients) client.end();
      reloadClients.clear();
    });
  }

  return server;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT || "4173", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("PORT must be an integer from 0 through 65535");
    process.exitCode = 1;
  } else {
    const server = createStaticServer({ root: fileURLToPath(new URL(".", import.meta.url)) });
    server.on("error", error => {
      console.error(`Could not start Balaur server: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : port;
      console.log(`Balaur is available at http://${host}:${activePort}`);
    });
  }
}
