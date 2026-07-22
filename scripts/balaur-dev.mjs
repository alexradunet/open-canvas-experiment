#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "../server.mjs";

const HELP = `Balaur development server

Usage:
  balaur-dev [options]

Options:
  --host <host>  Bind address (default: 0.0.0.0)
  --port <port>  Port (default: 8080)
  --help         Show this help

Examples:
  balaur-dev
  balaur-dev --port 8082

Runs the dependency-free Balaur static server from the repository root,
reloads connected browsers when files change, and prints local and NetBird
access URLs. Press Ctrl+C to stop.
`;

function parseArgs(argv) {
  const options = { host: process.env.HOST || "0.0.0.0", port: process.env.PORT || "8080" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (argument === "--host") {
      options.host = argv[++index];
    } else if (argument.startsWith("--host=")) {
      options.host = argument.slice("--host=".length);
    } else if (argument === "--port") {
      options.port = argv[++index];
    } else if (argument.startsWith("--port=")) {
      options.port = argument.slice("--port=".length);
    } else {
      process.stderr.write(`Unknown option: ${argument}\n\n${HELP}`);
      process.exit(64);
    }
  }

  const port = Number.parseInt(options.port, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write("PORT must be an integer from 0 through 65535\n");
    process.exit(64);
  }
  options.port = port;
  return options;
}

function netbirdInterfaceAddress() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (!name.toLowerCase().includes("netbird")) continue;
    for (const entry of interfaces[name] ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "";
}

function netbirdStatusValue(key) {
  try {
    const result = spawnSync("netbird", ["status"], { encoding: "utf8", timeout: 4000 });
    if (result.status !== 0) return "";
    const match = result.stdout.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function accessLines(host, port) {
  const lines = [];
  const localHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  lines.push(`Local (on this machine):    http://${localHost}:${port}`);
  if (localHost !== "localhost") lines.push(`Local loopback:             http://localhost:${port}`);

  const netbirdIp = netbirdInterfaceAddress();
  const netbirdFqdn = (netbirdStatusValue("FQDN") || "").replace(/\.$/, "");
  if (netbirdIp) lines.push(`NetBird (from your devices): http://${netbirdIp}:${port}`);
  if (netbirdFqdn) lines.push(`NetBird name:               http://${netbirdFqdn}:${port}`);
  if (!netbirdIp && !netbirdFqdn) {
    lines.push("NetBird:                    status unavailable; run: netbird status");
  }
  return lines;
}

const { host, port } = parseArgs(process.argv.slice(2));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = createStaticServer({ root, liveReload: true });

server.on("error", error => {
  if (error?.code === "EADDRINUSE") {
    process.stderr.write(
      [
        `Port ${port} is already in use.`,
        "",
        "The systemd development server may be running:",
        "  sudo systemctl status balaur-dev",
        "  sudo systemctl restart balaur-dev",
        "",
        "Or choose another port:",
        `  balaur-dev --port ${port + 1}`,
        "",
      ].join("\n"),
    );
  } else {
    process.stderr.write(`Could not start Balaur development server: ${error.message}\n`);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(
    [
      "",
      "Balaur development server",
      `Repository: ${root}`,
      `Bound to:   ${host}:${activePort}`,
      "",
      ...accessLines(host, activePort),
      "",
      "Live reload: enabled",
      "",
      "Notes:",
      "  The NixOS firewall exposes this port only on the NetBird interface.",
      "  Press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
