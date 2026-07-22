/**
 * Pane creation and agent lifecycle management.
 *
 * Orchestrates Herdr API calls to create panes, start interactive Pi
 * sessions, and manage worker lifecycle. Uses the HerdrClient for
 * socket communication.
 *
 * @module pane-manager
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { roleToPiArgs } from './role-parser.js';

/** @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @typedef {import('./herdr-client.js').HerdrClient} HerdrClient
 * @typedef {import('./role-parser.js').RoleConfig} RoleConfig
 * @typedef {import('./handle-store.js').WorkerHandle} WorkerHandle
 */

/**
 * Create a new pane by splitting the current pane.
 *
 * @param {HerdrClient} client
 * @param {Object} opts
 * @param {string} opts.currentPaneId - The pane to split.
 * @param {string} [opts.direction]   - Split direction ('right' or 'down').
 * @param {number} [opts.ratio]       - Split ratio (0-1).
 * @param {string} [opts.cwd]         - Working directory for the new pane.
 * @param {Record<string,string>} [opts.env] - Extra environment variables.
 * @returns {Promise<{ pane_id: string, workspace_id: string, tab_id: string }>}
 */
export async function createPane(client, opts) {
  const result = await client.request('pane.split', {
    target_pane_id: opts.currentPaneId,
    direction: opts.direction || 'right',
    ratio: opts.ratio || 0.5,
    cwd: opts.cwd,
    focus: false,
    env: opts.env || {},
  });

  const pane = result.result?.pane || result.result;
  return {
    pane_id: pane.pane_id,
    workspace_id: pane.workspace_id,
    tab_id: pane.tab_id,
  };
}

/**
 * Start an interactive Pi agent in a pane.
 *
 * @param {HerdrClient} client
 * @param {Object} opts
 * @param {string} opts.paneId       - Target pane ID.
 * @param {string} opts.agentName    - Agent name (from .pi/agents/*.md).
 * @param {RoleConfig} opts.role     - Parsed role configuration.
 * @param {string} [opts.cwd]        - Working directory.
 * @param {number} [opts.timeoutMs]  - Startup timeout.
 * @returns {Promise<{ agent_name: string, pane_id: string }>}
 */
export async function startAgent(client, opts) {
  const promptFile = await writeRolePromptFile(opts.role);
  try {
    const piArgs = replacePromptArg(roleToPiArgs(opts.role), promptFile.path);
    const skillArgs = resolveRoleSkillArgs(opts.role, opts.cwd);

    const result = await client.request('agent.start', {
      name: opts.agentName,
      kind: 'pi',
      pane_id: opts.paneId,
      args: [...piArgs, ...skillArgs],
      timeout_ms: opts.timeoutMs || 30000,
    });

    const agent = result.result?.agent || result.result;
    return {
      agent_name: agent.name || opts.agentName,
      pane_id: agent.pane_id || opts.paneId,
      promptFile,
    };
  } catch (err) {
    await removeRolePromptFile(promptFile);
    throw err;
  }
}

async function writeRolePromptFile(role) {
  const dir = await mkdtemp(join(tmpdir(), 'balaur-herdr-role-'));
  const path = join(dir, 'system-prompt.md');
  await writeFile(path, role.prompt, { encoding: 'utf-8', mode: 0o600 });
  return { dir, path };
}

function replacePromptArg(args, promptPath) {
  const index = args.findIndex((arg) => arg === '--system-prompt' || arg === '--append-system-prompt');
  if (index === -1) return args;
  const copy = [...args];
  copy[index + 1] = promptPath;
  return copy;
}

export async function removeRolePromptFile(promptFile) {
  if (promptFile?.dir) {
    await rm(promptFile.dir, { recursive: true, force: true });
  }
}

/**
 * Resolve role skill names to explicit, project-local Pi skill files.
 *
 * @param {RoleConfig} role
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function resolveRoleSkillArgs(role, cwd) {
  const args = [];
  for (const skill of role.skills || []) {
    const path = resolve(cwd || process.cwd(), '.pi', 'skills', skill, 'SKILL.md');
    if (!existsSync(path)) {
      throw new Error(`role skill '${skill}' is missing: ${path}`);
    }
    args.push('--skill', path);
  }
  return args;
}

/**
 * Wait for an agent to become interactive-ready (not just started).
 * Polls agent.get until interactive_ready is true or launch is no longer pending.
 *
 * @param {HerdrClient} client
 * @param {string} agentName
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export async function waitForInteractiveReady(client, agentName, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const agent = await getAgent(client, agentName);
      if (agent?.interactive_ready && !agent?.launch_pending) {
        return;
      }
    } catch (err) {
      // agent_not_ready is expected during launch; keep polling.
      if (err.message?.includes('agent_not_found')) {
        throw err;
      }
    }
    await sleep(500);
  }
  throw new Error(`agent ${agentName} did not become interactive-ready within ${timeoutMs}ms`);
}
/**
 * Wait for an agent to reach a target status.
 *
 * @param {HerdrClient} client
 * @param {Object} opts
 * @param {string} opts.target     - Agent name/identifier.
 * @param {string[]} opts.until    - Target statuses (e.g. ['idle', 'done']).
 * @param {number} [opts.timeoutMs] - Wait timeout.
 * @returns {Promise<{ status: string, timedOut: boolean }>}
 */
export async function waitForAgent(client, opts) {
  try {
    const result = await client.request('agent.wait', {
      target: opts.target,
      until: opts.until,
      timeout_ms: opts.timeoutMs || 60000,
    }, opts.timeoutMs ? opts.timeoutMs + 5000 : undefined);

    const agent = result.result?.agent || result.result;
    return {
      status: agent?.agent_status || 'unknown',
      timedOut: false,
    };
  } catch (err) {
    if (err.message?.includes('timed out')) {
      return { status: 'timeout', timedOut: true };
    }
    throw err;
  }
}

/**
 * Send a prompt to an agent.
 *
 * @param {HerdrClient} client
 * @param {Object} opts
 * @param {string} opts.target     - Agent name/identifier.
 * @param {string} opts.text       - Prompt text.
 * @param {boolean} [opts.wait]    - Wait for completion.
 * @param {number} [opts.timeoutMs] - Timeout.
 * @returns {Promise<{ status: string }>}
 */
export async function promptAgent(client, opts) {
  const params = {
    target: opts.target,
    text: opts.text,
  };

  if (opts.wait) {
    params.wait = {
      until: ['idle', 'done'],
      timeout_ms: opts.timeoutMs || 120000,
    };
  }

  const result = await client.request('agent.prompt', params,
    opts.wait ? (opts.timeoutMs || 120000) + 5000 : undefined);

  const agent = result.result?.agent || result.result;
  return {
    status: agent?.agent_status || 'unknown',
  };
}

/**
 * Read diagnostic terminal output from an agent.
 *
 * @param {HerdrClient} client
 * @param {Object} opts
 * @param {string} opts.target    - Agent name/identifier.
 * @param {string} [opts.source]  - Read source ('visible', 'recent', 'all').
 * @param {number} [opts.lines]   - Number of lines.
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
export async function readAgent(client, opts) {
  const result = await client.request('agent.read', {
    target: opts.target,
    source: opts.source || 'recent',
    lines: opts.lines || 200,
    format: 'text',
    strip_ansi: true,
  });

  const read = result.result?.read || result.result;
  return {
    text: read?.text || '',
    truncated: !!read?.truncated,
  };
}

/**
 * List all known agents.
 *
 * @param {HerdrClient} client
 * @returns {Promise<Array<Object>>}
 */
export async function listAgents(client) {
  const result = await client.request('agent.list', {});
  return result.result?.agents || [];
}

/**
 * Get info about a specific agent.
 *
 * @param {HerdrClient} client
 * @param {string} target
 * @returns {Promise<Object>}
 */
export async function getAgent(client, target) {
  const result = await client.request('agent.get', { target });
  return result.result?.agent || result.result;
}

/**
 * Verify that an operation still addresses the exact agent/pane pair created
 * for a handle. A missing agent or any different pane/name is never rebound.
 *
 * @param {HerdrClient} client
 * @param {{ agentName?: string, paneId: string, status?: string }} handle
 * @returns {Promise<Object>}
 */
export async function assertPinnedAgent(client, handle) {
  if (!handle.agentName) throw new Error('worker has no agent name');
  try {
    const agent = await getAgent(client, handle.agentName);
    if (agent?.name !== handle.agentName || agent?.pane_id !== handle.paneId) {
      handle.status = 'replaced';
      throw new Error(`worker occupant was replaced for pane ${handle.paneId}`);
    }
    return agent;
  } catch (err) {
    if (err.message?.includes('replaced')) throw err;
    handle.status = 'missing';
    throw new Error(`worker is missing from pane ${handle.paneId}: ${err.message}`);
  }
}

/**
 * Close a pane (requires human confirmation at the tool level).
 *
 * @param {HerdrClient} client
 * @param {string} paneId
 * @returns {Promise<void>}
 */
export async function closePane(client, paneId) {
  await client.request('pane.close', { pane_id: paneId });
}

/**
 * Report metadata on a pane for role and bridge state publication.
 *
 * @param {HerdrClient} client
 * @param {string} paneId
 * @param {Record<string, string>} tokens
 * @returns {Promise<void>}
 */
export async function reportPaneMetadata(client, paneId, tokens) {
  await client.request('pane.report_metadata', {
    pane_id: paneId,
    tokens,
  });
}

/**
 * Build the environment variables for a worker session.
 * Injects BALAUR_WORKER=1 and ensures herdr_agent is inactive.
 *
 * @param {Record<string, string>} [baseEnv]
 * @returns {Record<string, string>}
 */
export function buildWorkerEnv(baseEnv) {
  return {
    ...(baseEnv || {}),
    BALAUR_WORKER: '1',
    BALAUR_HERDR_AGENT_INACTIVE: '1',
  };
}
