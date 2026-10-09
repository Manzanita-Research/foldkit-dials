# Agent development notes

Read [FOLDKIT.md](FOLDKIT.md) before changing Foldkit code. It is the
unchanged framework template from the installed release. This file owns
project instructions; upgrades replace FOLDKIT.md, not AGENTS.md.

subtree_prompted: true

## Scope and references

This workspace contains a published component library and a private demo
application. Apply the framework's application conventions to `demo/`.
For library code, also read
[packages/foldkit-dials/CONVENTIONS.md](packages/foldkit-dials/CONVENTIONS.md):
headless components expose parent-owned values and explicit public types;
they do not boot a Runtime. The demo boots in `demo/src/entry.ts` and keeps
testable definitions in `demo/src/main.ts`.

`repos/foldkit/` is a read-only git subtree at **foldkit@0.166.0**, commit
`7590156835c822a0aa135a5fde14c8e2009c9124`. Use its framework source,
`packages/ui/src/`, examples and skills for release-specific APIs. Its
AGENTS.md describes upstream code practices; its repository maintenance,
package scripts and release procedures belong to upstream, not this repo.
Installed declarations remain authoritative for the packages we compile
against. Never import application code from `repos/`, modify reference
files, install inside them, or add them to workspace/build/check globs.

Foldkit, generate-program and audit-program skills are symlinked into
`.agents/skills/` and `.claude/skills/`. The existing Effect skill is a
local snapshot reviewed against Effect 4.0.0. Use it for Effect APIs,
while keeping Foldkit Model/Message/Command conventions in Foldkit code.
`CLAUDE.md` links here so both agent hosts read the same project guidance.
See [docs/agent-reference.md](docs/agent-reference.md) for pin verification,
refresh commands, skill discovery and DevTools MCP setup.

Use Foldkit and Effect primitives before adding dependencies. Preserve
the library stylesheet's DialKit attribution and existing optional Pleat
demo integration. Do not introduce another styling or UI framework.

## Dependency ownership

- Root `package.json` owns shared test, TypeScript, lint and format tools.
  Install once at the root with `pnpm install --frozen-lockfile` using
  pnpm 12.10.1. Never install independently in nested packages.
- `packages/foldkit-dials` declares consumer peers and matching development
  dependencies. It publishes built JS, declarations and CSS, not demo,
  DevTools, deployment tools or reference sources. Preserve explicit
  public factory return types and the source/packed consumer type checks.
- `demo` owns application runtime dependencies, Pleat, Vite, DevTools,
  the pinned MCP server and its Alchemy stack. `stacks` owns the separate
  credential bootstrap. Root deployment scripts forward to the demo.
- `pnpm-workspace.yaml` owns shared runtime versions and supply-chain
  policy. Keep Foldkit 0.166.0 and Effect 4.0.0 pinned. Update references
  after an authorized package upgrade; never upgrade runtime packages
  just to get newer documentation. Keep the frozen lockfile in sync with
  intentional manifest changes. Run/exec reject stale installs.

## Verification and delivery

`pnpm check` is the repository and CI check: formatting, lint, types,
Vitest, demo and library builds, package contents, and the source/packed
DialPanel consumer fixture. Useful focused commands from the root:

- `pnpm format:check`; `pnpm format <files...>` to write selected files.
- `pnpm lint` for owned JS/TS with correctness rules and explicit Foldkit
  presets. Nested lint discovery is disabled.
- `pnpm typecheck` or `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
- `pnpm test` or `node_modules/.bin/vitest run <test-path>`.
- `pnpm build:library`, `pnpm build:demo`, `pnpm typecheck:panel-consumer`.
- `pnpm dev` for a short-lived demo at `http://127.0.0.1:5267`.

Add meaningful Story/Scene coverage when changing behavior and keep
runtime boot out of modules imported by tests. Reference trees and skill
links are excluded from lint/format; TypeScript, Vitest, builds and pnpm
workspaces include only owned paths. FOLDKIT.md is excluded from formatting
to preserve the canonical template byte for byte.

Work in one assigned branch/worktree; never switch branches in place or
clean shared Git metadata. Serialize installs, full checks, builds and
browser jobs with the shared `/tmp/fkd-heavy-jobs.lock` when working on a
shared builder. Stop servers/watchers at turn end unless handing over a
live preview. Get independent review of the exact committed head before
pushing or opening a PR. Ship through real PRs and green CI; deployment,
credentials and visual decisions follow the assignment's approval rules.
Do not post messages to upstream repositories.

For demo deployment/profile/build details, use the root README and
`demo/README.md` when present. Keep credential bootstrap separate from
routine demo work; do not rotate credentials to resolve an unrelated task.
