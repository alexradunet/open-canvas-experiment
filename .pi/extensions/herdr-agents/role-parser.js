/** Strict `.pi/agents/*.md` role parsing and safe Pi launch preparation. */

const ALLOWED_THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const ALLOWED_PROMPT_MODE = new Set(['replace', 'append']);
const TOOL_WILDCARD = '*';
export const ORCHESTRATION_TOOLS = Object.freeze([
  'herdr_agent',
  'balaur_workflow',
  'Agent',
  'get_subagent_result',
  'steer_subagent',
  'ext:pi-subagents/Agent',
]);
const EXCLUDED_TOOLS = new Set(ORCHESTRATION_TOOLS);
// Wildcard roles are intentionally reduced to Pi built-ins. This keeps the
// installed pi-subagents package available to the lead while preventing a
// worker from acquiring orchestration tools through the wildcard.
export const SAFE_WILDCARD_TOOLS = Object.freeze(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
const UNSAFE_CHARS = /[\x00`$\\;|&<>(){}!\n\r]/;

export function parseRoleFile(content, filePath) {
  if (typeof content !== 'string' || content.length === 0) throw new Error(`${filePath}: empty file`);
  const { frontmatter, body } = splitFrontmatter(content, filePath);
  return buildRoleConfig(frontmatter, body, filePath);
}

export function roleNameFromFilename(filename) {
  if (!filename.endsWith('.md')) throw new Error(`not a .md file: ${filename}`);
  const name = filename.slice(0, -3);
  if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error(`invalid role filename: ${filename}`);
  return name;
}

function splitFrontmatter(content, filePath) {
  const text = content.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) throw new Error(`${filePath}: missing frontmatter delimiter`);
  const endIdx = text.indexOf('\n---', 3);
  if (endIdx === -1) throw new Error(`${filePath}: unterminated frontmatter`);
  const fmBlock = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 4).replace(/^\r?\n/, '');
  const frontmatter = {};
  for (const rawLine of fmBlock.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) throw new Error(`${filePath}: malformed frontmatter line: ${line}`);
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function buildRoleConfig(fm, body, filePath) {
  if (!fm.description) throw new Error(`${filePath}: missing or empty 'description'`);
  if (!body.trim()) throw new Error(`${filePath}: missing role prompt body`);
  const config = { filePath, description: fm.description, prompt: body };
  if (fm.model) { assertSafeIdentifier(fm.model, 'model', filePath); config.model = fm.model; }
  if (fm.thinking) {
    if (!ALLOWED_THINKING.has(fm.thinking)) throw new Error(`${filePath}: invalid thinking level '${fm.thinking}'; allowed: ${[...ALLOWED_THINKING].join(', ')}`);
    config.thinking = fm.thinking;
  }
  if (fm.tools) {
    if (fm.tools.trim() === TOOL_WILDCARD) config.tools = [TOOL_WILDCARD];
    else {
      config.tools = fm.tools.split(',').map((tool) => tool.trim()).filter(Boolean);
      for (const tool of config.tools) assertSafeToolName(tool, filePath);
    }
  }
  if (fm.skills) {
    config.skills = fm.skills.split(',').map((skill) => skill.trim()).filter(Boolean);
    for (const skill of config.skills) assertSafeSkillName(skill, filePath);
  }
  if (fm.prompt_mode) {
    if (!ALLOWED_PROMPT_MODE.has(fm.prompt_mode)) throw new Error(`${filePath}: invalid prompt_mode '${fm.prompt_mode}'; allowed: ${[...ALLOWED_PROMPT_MODE].join(', ')}`);
    config.prompt_mode = fm.prompt_mode;
  }
  return config;
}

function assertSafeIdentifier(value, field, filePath) {
  if (UNSAFE_CHARS.test(value) || !/^[A-Za-z0-9_.:/@+-]+$/.test(value)) throw new Error(`${filePath}: unsafe characters in '${field}': ${value}`);
}
function assertSafeToolName(value, filePath) {
  if (value !== TOOL_WILDCARD && (UNSAFE_CHARS.test(value) || !/^[A-Za-z0-9_.:/@+-]+$/.test(value))) throw new Error(`${filePath}: unsafe characters in 'tools': ${value}`);
}
function assertSafeSkillName(value, filePath) {
  if (UNSAFE_CHARS.test(value) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${filePath}: unsafe characters in 'skills': ${value}`);
}

export function filteredRoleTools(role) {
  if (role.tools?.[0] === TOOL_WILDCARD) return [...SAFE_WILDCARD_TOOLS];
  return (role.tools || []).filter((tool) => !EXCLUDED_TOOLS.has(tool));
}

export function roleToPiArgs(role) {
  const args = [];
  if (role.model) args.push('--model', role.model);
  if (role.thinking) args.push('--thinking', role.thinking);
  const tools = filteredRoleTools(role);
  if (tools.length) args.push('--tools', tools.join(','));
  if (role.prompt) args.push(role.prompt_mode === 'append' ? '--append-system-prompt' : '--system-prompt', role.prompt);
  return args;
}
