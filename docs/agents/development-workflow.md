# Pi development workflow

Balaur uses Pi interactively; there is no background issue poller or unattended scheduler. `.pi/subagents.json` disables scheduled subagents.

## Product definition

For unclear or substantial product work:

1. Use the `grilling` skill to resolve requirements, vocabulary, and architectural decisions.
2. Use `prototype` only when a risky interaction or technical seam needs evidence.
3. Publish the agreed behavior and testing decisions in the issue or spec.
4. Split large work into dependency-aware tracer-bullet issues.
5. Implement only after an issue is `ready-for-agent`.

Skip this ceremony for a small, direct request with clear behavior and a clear test seam.

## Model lanes

The top-level Pi session is the lead. Change its model with `/model` when required.

| Lane | Primary | Provider fallback |
|---|---|---|
| Lead and planning | GPT-5.6 Sol, high | `advisor-qwen`: Qwen3.8 Max Preview |
| Implementation | `implementer`: Qwen3.7 Plus | `implementer-openai`: GPT-5.6 Terra |
| Review A | `reviewer-sol`: GPT-5.6 Sol | `reviewer-qwen`: Qwen3.8 Max Preview |
| Review B | `reviewer-glm`: GLM-5.2 | `reviewer-terra`: GPT-5.6 Terra |
| Research | `researcher-sol`: GPT-5.6 Sol | `researcher-qwen`: Qwen3.8 Max Preview |
| Exploration | built-in `Explore`: Qwen3.6 Flash | lead |

Fallbacks are only for provider failure, rate limiting, exhausted quota, or a failed GLM tool-call probe. Correct poor output in the same lane. Report every provider switch.

Before relying on Review B, run a harmless GLM-5.2 probe that searches and reads files and runs `git status --short` at `max` thinking. Use `reviewer-terra` if tool calling or thinking propagation fails.

## Issue to pull request

When directed to implement an eligible issue, the lead:

1. Reads the complete issue, comments, labels, linked specs, glossary, relevant ADRs, and code.
2. Confirms `ready-for-agent`, unless the user explicitly overrides the gate.
3. Records the base SHA and creates `agent/<issue>-<slug>` at `/tmp/balaur-workers/<issue>-<slug>` with `git worktree add`.
4. Launches `implementer` with the absolute worktree path, acceptance criteria, constraints, and required checks.
5. Inspects the actual diff and command evidence.
6. Launches Review A and Review B independently and in parallel against the complete base-to-branch diff; neither receives the other's output.
7. Resumes the implementer with actionable findings, then reruns both complete reviews. At most two revision cycles are allowed.
8. Stops and reports a blocked state if material findings remain; never weakens the gate.
9. Runs final checks, pushes only the non-main branch, and opens—but never merges—a pull request linking the issue.

If an implementer can no longer be resumed, launch a fresh one with the full issue, worktree path, findings, and current diff. Never continue implementation in the main checkout.

Pi tool allowlists guide agents but are not an OS sandbox. The lead must inspect commands and diffs. Never force-push, push to `main`, reset/clean unrelated work, expose credentials, or let implementation/review agents push.

## Pull request content

Include the linked issue and result, architectural/domain decisions, checks actually run, browser verification and pending gaps, both review outcomes and fallbacks, and residual risks. Opening the pull request ends agent autonomy; merge is a human decision.

## Credentials and startup

From a NetBird SSH terminal:

```bash
cd /home/balaur/projects/balaur
pi
```

On first use, approve the repository with `/trust`, restart Pi, and let it install the reviewed project packages from `.pi/settings.json`. Authenticate with `/login openai-codex` and `/login qwen-token-plan`; Pi stores credentials in `~/.pi/agent/auth.json` with mode `0600`. Never commit, print, or expose that file. Use `/model` to confirm configured models and `/agents` to confirm agent definitions. Use `/reload` after resource changes, or restart if required. `/share` is opt-in and must not be used for sensitive sessions.

Pi runs as the `balaur` user without a built-in sandbox and the account has passwordless `sudo`; treat every loaded package and agent command as trusted code. Disconnecting ends an in-flight terminal process, but completed session history can be resumed with `pi -c`.

### NetBird Cloud extension credential

The project-local `.pi/extensions/balaur-netbird/` extension uses a dedicated NetBird **service user** with the **Network Admin** role. A human operator must create that service user and its Personal Access Token in the NetBird dashboard. Never use an account-owner or human-user token.

Apply the NixOS configuration to create the protected group, directory, and empty credential file, then edit it without placing the token in shell history:

```bash
sudo nixos-rebuild switch --flake ./nixos_dev_env
# Disconnect and reconnect NetBird SSH so balaur receives the new group.
sudoedit /etc/balaur/netbird.env
sudo chown root:balaur-secrets /etc/balaur/netbird.env
sudo chmod 0640 /etc/balaur/netbird.env
```

The file contains only the `NETBIRD_API_TOKEN` assignment. Never print, source, copy, or inspect it through Pi, logs, issues, chat, command arguments, Nix expressions, or systemd environment settings. A fresh login is required after the group is first created; restarting Pi or `/reload` cannot refresh supplementary groups. After reconnecting, start Pi and use `/netbird doctor` to verify local readiness and Cloud access without exposing the credential.

To rotate, create a replacement PAT for the same service user, replace the file contents with `sudoedit`, verify with `/netbird doctor`, and only then revoke the old PAT in NetBird. Do not print either token. See [ADR 0003](../adr/0003-netbird-pi-extension.md) and the [extension README](../../.pi/extensions/balaur-netbird/README.md).
