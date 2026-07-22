import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectSessionResult, extractFinalizedResult, resolvePiSessionReference, waitForFinalizedSessionResult, waitForPiSessionReference } from '../session-collector.js';

const fixture = resolve('.pi/extensions/herdr-agents/test/fixtures/session.jsonl');
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

describe('Pi v3 session collection', () => {
  it('parses persisted type=message entries and associates results by toolCallId', async () => {
    const result = await collectSessionResult(fixture);
    assert.equal(result.stopReason, 'stop');
    assert.equal(result.text, 'Task completed successfully.');
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].id, 'call_1');
    assert.equal(result.toolCalls[0].result.text, 'ok');
    assert.equal(result.turns, 2);
  });

  it('does not associate same-name tools without matching toolCallId', () => {
    const entries = [
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call-a', name: 'bash', arguments: {} }], stopReason: 'toolUse', usage } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call-b', toolName: 'bash', content: [{ type: 'text', text: 'wrong' }], isError: false } },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'final' }], stopReason: 'stop', usage } },
    ];
    const result = extractFinalizedResult(entries);
    assert.equal(result.toolCalls[0].result, undefined);
  });

  it('returns incomplete for only partial assistant output', () => {
    const result = extractFinalizedResult([{ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } }]);
    assert.equal(result.stopReason, 'incomplete');
  });

  it('resolves a session id only beneath the configured Pi session root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-sessions-'));
    const id = '22222222-2222-2222-2222-222222222222';
    const nested = join(root, 'project');
    await mkdir(nested);
    const path = join(nested, 'session.jsonl');
    await writeFile(path, JSON.stringify({ type: 'session', version: 3, id, cwd: '/test' }) + '\n');
    try {
      assert.equal(await resolvePiSessionReference({ kind: 'id', value: id }, root), path);
      await assert.rejects(resolvePiSessionReference({ kind: 'id', value: '../bad' }, root), /invalid Pi session ID/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('retries a session id until its Pi file appears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-id-late-'));
    const id = '55555555-5555-5555-5555-555555555555';
    const dir = join(root, 'project'); await mkdir(dir);
    const path = join(dir, 'session.jsonl');
    setTimeout(() => void writeFile(path, JSON.stringify({ type: 'session', version: 3, id, cwd: '/test' }) + '\n'), 100);
    try { assert.equal(await waitForPiSessionReference({ kind: 'id', value: id }, 2000, undefined, root), path); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('retries a late-created final Pi session file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-late-'));
    const path = join(root, 'session.jsonl');
    setTimeout(() => void writeFile(path, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'ready' }], stopReason: 'stop', usage } }) + '\n'), 100);
    try { assert.equal((await waitForFinalizedSessionResult(path, 2000)).text, 'ready'); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it('honors AbortSignal while retrying collection', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(waitForFinalizedSessionResult('/missing/session.jsonl', 1000, controller.signal), /collection aborted/);
  });
});
