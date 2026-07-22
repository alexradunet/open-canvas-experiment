# ADR 0003: Closed, TUI-confirmed NetBird Pi extension

- Status: Accepted
- Date: 2026-07-22

## Context

Balaur is developed remotely over NetBird, and Pi runs as the privileged local `balaur` account. Operators need quick network visibility and carefully controlled NetBird Cloud administration without copying credentials into prompts, sessions, shell history, the repository, Nix store, or systemd environments.

A generic HTTP tool or an unattended mutation path would turn model-provided strings into account-wide network administration. A dashboard with write controls would also make review and confirmation boundaries harder to audit. The NetBird API uses replace-oriented `PUT` operations, so stale reads are material.

## Decision

Ship a project-local extension under `.pi/extensions/balaur-netbird/` with these boundaries:

1. The only remote origin is `https://api.netbird.io`. Internal domain methods own every documented endpoint and HTTP method; tool input never provides either.
2. A dedicated NetBird service-user Personal Access Token with the Network Admin role is read on demand from `/etc/balaur/netbird.env`. The file must be a non-symlink regular file owned by `root:balaur-secrets` with mode `0640`, and it may contain only one `NETBIRD_API_TOKEN` assignment plus comments and blank lines.
3. NixOS creates the group, protected directory, and empty file, but never contains or propagates the token value.
4. Read access is limited to overview, peers, groups, policies, networks, routes, DNS settings/nameserver groups, posture checks, and recent events. Responses and projections are bounded.
5. The dashboard is a non-overlay read-only TUI. `/netbird doctor` and the low-frequency footer status combine local daemon readiness with a secret-free Cloud peer summary.
6. Mutations are limited to create/replace/delete for groups, policies, posture checks, routes, networks, and nameserver groups, plus DNS-settings replacement. All peer writes are unavailable because Network Admin has read-only peer access.
7. Mutation contracts reject unknown operations and top-level body fields and recursively reject prototype-pollution keys. IDs cannot contain slash or traversal forms.
8. Mutation execution fails before network access outside TUI mode, uses one lock, reads existing state for replacement/deletion/update, produces a deterministic bounded preview, obtains `ctx.ui.confirm`, then re-reads and compares stable serialization for staleness before sending exactly one write. Cancellation or stale state sends no write.
9. Outputs, previews, errors, status, and session-persisted tool details are normalized and secret-free. API error bodies and authorization headers are never surfaced.

## Consequences

- Pi can inspect a useful but deliberately narrow NetBird account projection and can perform reviewed network-management changes.
- New API resources, body fields, or mutations require an explicit code and contract change; there is no escape hatch for arbitrary endpoints.
- Replace/delete operations read once for the preview and once after confirmation. This narrows but cannot eliminate the final API race because the documented API does not expose an optimistic write precondition in this integration.
- Operators must manually create and rotate a dedicated PAT and preserve file ownership/mode.
- Non-TUI Pi modes retain read access but cannot mutate NetBird.
- The extension uses only Node built-ins and Pi-provided packages and introduces no package manager or dependency manifest.

## References

- [NetBird API](https://docs.netbird.io/api)
- [NetBird API authentication](https://docs.netbird.io/api/guides/authentication)
- [NetBird service users and PATs](https://docs.netbird.io/manage/public-api)
- [NetBird roles](https://docs.netbird.io/manage/team/user-roles)
- [NetBird OpenAPI](https://github.com/netbirdio/netbird/blob/main/shared/management/http/api/openapi.yml)
