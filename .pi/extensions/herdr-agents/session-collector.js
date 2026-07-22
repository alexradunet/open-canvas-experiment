/** Authoritative Pi v3 JSONL session result collection. */
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MAX_SESSION_BYTES = 10 * 1024 * 1024;
export const MAX_SESSION_LINES = 100_000;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePiSessionReference(session, sessionRoot = join(homedir(), '.pi', 'agent', 'sessions')) {
  if (!session || (session.kind !== 'path' && session.kind !== 'id') || typeof session.value !== 'string') throw new Error('invalid Pi session reference');
  if (session.kind === 'path') {
    if (!session.value.startsWith('/') || !session.value.endsWith('.jsonl') || /[\x00\n\r]/.test(session.value)) throw new Error('unsafe Pi session path reference');
    // Herdr can report the absolute path just before Pi creates it; the
    // bounded collector retry owns that creation/flush race.
    return session.value;
  }
  if (!SESSION_ID_RE.test(session.value)) throw new Error('invalid Pi session ID reference');
  const matches = await findSessionFilesById(sessionRoot, session.value);
  if (matches.length !== 1) throw new Error(matches.length ? `ambiguous Pi session ID: ${session.value}` : `Pi session ID not found: ${session.value}`);
  return matches[0];
}

async function findSessionFilesById(root, sessionId) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const firstLine = (await readFile(path, 'utf8')).split('\n', 1)[0];
        try { if (JSON.parse(firstLine)?.type === 'session' && JSON.parse(firstLine)?.id === sessionId) files.push(path); } catch { /* ignore malformed candidate */ }
      }
    }
  }
  await walk(root);
  return files;
}

export async function waitForPiSessionReference(session, timeoutMs = 10000, signal, sessionRoot) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('collection aborted');
    try { return await resolvePiSessionReference(session, sessionRoot); } catch (error) { lastError = error; }
    await sleep(250, signal);
  }
  throw lastError || new Error('Pi session reference was not resolved');
}

export async function collectSessionResult(filePath) {
  return extractFinalizedResult(await readJsonlEntries(filePath));
}

export async function waitForFinalizedSessionResult(filePath, timeoutMs = 10000, signal) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('collection aborted');
    try {
      const result = await collectSessionResult(filePath);
      if (result.stopReason !== 'incomplete') return result;
    } catch (error) { lastError = error; }
    await sleep(250, signal);
  }
  if (lastError) throw lastError;
  return collectSessionResult(filePath);
}

function sleep(ms, signal) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
    if (signal?.aborted) { clearTimeout(timer); reject(new Error('collection aborted')); }
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('collection aborted')); }, { once: true });
  });
}

export async function readJsonlEntries(filePath) {
  const entries = [];
  let bytes = 0;
  let lines = 0;
  return new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    const parse = (line) => {
      if (!line.trim()) return;
      lines++;
      if (lines > MAX_SESSION_LINES) { stream.destroy(); reject(new Error(`session file exceeds maximum lines (${MAX_SESSION_LINES})`)); return; }
      try { entries.push(JSON.parse(line)); } catch { /* malformed records do not become results */ }
    };
    stream.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_SESSION_BYTES) { stream.destroy(); reject(new Error(`session file exceeds maximum size (${MAX_SESSION_BYTES} bytes)`)); return; }
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const line of parts) parse(line);
    });
    stream.on('end', () => { if (buffer.trim()) parse(buffer); resolvePromise(entries); });
    stream.on('error', (error) => reject(new Error(`failed to read session file: ${error.message}`)));
  });
}

export function extractFinalizedResult(entries) {
  if (!Array.isArray(entries)) return incomplete([]);
  const calls = new Map();
  let finalAssistant;
  let turns = 0;
  for (const entry of entries) {
    if (entry?.type !== 'message' || !entry.message || typeof entry.message !== 'object') continue;
    const message = entry.message;
    if (message.role === 'assistant' && typeof message.stopReason === 'string') {
      turns++;
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part?.type === 'toolCall' && typeof part.id === 'string') calls.set(part.id, { id: part.id, name: String(part.name || 'unknown'), arguments: part.arguments || {} });
      }
      finalAssistant = message;
    }
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      const call = calls.get(message.toolCallId);
      if (call) call.result = summarizeToolResult(message);
    }
  }
  const toolCalls = [...calls.values()];
  if (!finalAssistant) return incomplete(toolCalls);
  return {
    text: (Array.isArray(finalAssistant.content) ? finalAssistant.content : []).filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n'),
    stopReason: finalAssistant.stopReason,
    model: finalAssistant.model,
    usage: finalAssistant.usage,
    toolCalls,
    turns,
  };
}

function incomplete(toolCalls) { return { text: '', stopReason: 'incomplete', toolCalls, turns: 0 }; }
function summarizeToolResult(message) {
  const text = (Array.isArray(message.content) ? message.content : []).filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
  return { isError: !!message.isError, text: text.length > 500 ? `${text.slice(0, 500)}...` : text };
}
