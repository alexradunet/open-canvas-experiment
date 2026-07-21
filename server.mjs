import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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

function sendText(response, status, message) {
  response.writeHead(status, {
    "Cache-Control": "no-cache",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

export function createStaticServer({ root = process.cwd() } = {}) {
  const publicRoot = resolve(root);

  return createServer(async (request, response) => {
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

      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": fileStat.size,
        "Content-Type": MIME_TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream",
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
