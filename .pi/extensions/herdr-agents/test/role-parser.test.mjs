import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { filteredRoleTools, ORCHESTRATION_TOOLS, parseRoleFile, roleNameFromFilename, roleToPiArgs } from '../role-parser.js';

const agentsDir = resolve('.pi/agents');
describe('role compatibility', () => {
  it('parses and prepares every current project role without dropping any', async () => {
    const files = (await readdir(agentsDir)).filter((file) => file.endsWith('.md'));
    assert.ok(files.length >= 1);
    for (const file of files) {
      const path = resolve(agentsDir, file);
      const role = parseRoleFile(await readFile(path, 'utf8'), path);
      const args = roleToPiArgs(role);
      assert.equal(roleNameFromFilename(file), file.slice(0, -3));
      assert.ok(args.includes('--system-prompt') || args.includes('--append-system-prompt'));
      for (const forbidden of ORCHESTRATION_TOOLS) assert.ok(!filteredRoleTools(role).includes(forbidden), `${file} leaked ${forbidden}`);
    }
  });

  it('accepts installed extension tool identifiers while excluding only orchestration', () => {
    const role = parseRoleFile('---\ndescription: extension tools\ntools: read, ext:pi-web-access/web_search, ext:pi-subagents/Agent\n---\nPrompt', '/roles/ext.md');
    assert.deepEqual(filteredRoleTools(role), ['read', 'ext:pi-web-access/web_search']);
  });

  it('constrains wildcard roles to safe non-orchestration tools', () => {
    const role = parseRoleFile('---\ndescription: wildcard\ntools: "*"\n---\nPrompt', '/roles/wild.md');
    const tools = filteredRoleTools(role);
    assert.ok(tools.includes('bash'));
    for (const forbidden of ORCHESTRATION_TOOLS) assert.ok(!tools.includes(forbidden));
  });

  it('retains a path-specific malformed-role error', () => {
    assert.throws(() => parseRoleFile('---\ndescription: bad\ntools: ext:bad tool\n---\nPrompt', '/roles/bad.md'), /\/roles\/bad\.md: unsafe characters/);
  });
});
