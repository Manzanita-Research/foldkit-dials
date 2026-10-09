# Release references and agent tooling

The setup follows Foldkit's [AI overview](https://foldkit.dev/ai/overview)
and [skills guide](https://foldkit.dev/ai/skills), using the installed
release rather than upstream main. A normal clone includes the entire
read-only git subtree; no submodule initialization is needed.

| Reference                                                 | Pin                                                                     | Owner                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| `repos/foldkit/`                                          | `foldkit@0.166.0`, `7590156835c822a0aa135a5fde14c8e2009c9124`           | Upstream release subtree          |
| `FOLDKIT.md`                                              | Exact release template in `packages/create-foldkit-app/templates/base/` | Foldkit                           |
| `.agents/skills/{foldkit,generate-program,audit-program}` | Symlinks to that release's `skills/`                                    | Foldkit                           |
| `.agents/skills/effect`                                   | `repos/effect-skill/`, reviewed against Effect 4.0.0                    | Snapshot of existing shared skill |
| `AGENTS.md`, library `CONVENTIONS.md`                     | Project-specific instructions                                           | This project                      |
| `@foldkit/vite-plugin` / `@foldkit/devtools-mcp`          | 0.26.1 / 0.24.1                                                         | Demo development dependencies     |

`CLAUDE.md` and `.claude/skills/*` link to the same instructions and skills.
Codex discovers `.agents/skills/`; invoke `$foldkit`, `$generate-program`,
`$audit-program` or `$effect`. Claude Code discovers `.claude/skills/`;
invoke `/foldkit`, `/generate-program`, `/audit-program` or `/effect`.
These project skills do not require an unpinned marketplace install.

## Verify the reference pin

After a frozen root install, run from the root:

```sh
node -p "require('./demo/node_modules/foldkit/package.json').version"
node -p "require('./packages/foldkit-dials/node_modules/foldkit/package.json').version"
git log --all --grep='git-subtree-dir: repos/foldkit' --format='%B'
git ls-remote --tags https://github.com/foldkit/foldkit.git 'foldkit@0.166.0'
cmp FOLDKIT.md repos/foldkit/packages/create-foldkit-app/templates/base/FOLDKIT.md
```

Both installed versions must be 0.166.0; the subtree's `git-subtree-split`
and the tag must identify the commit in the table. The subtree root tree
is `294b2e8d0eff53beb7b4d591b743da7c7c1b9955` (verify with
`git rev-parse HEAD:repos/foldkit`). Do not edit source in this tree.

Check that every discoverable link resolves after cloning:

```sh
test -f CLAUDE.md
for host in .agents .claude; do
  for skill in foldkit generate-program audit-program effect; do
    test -f "$host/skills/$skill/SKILL.md" || exit 1
  done
done
```

## Refresh after an authorized Foldkit upgrade

Keep library and demo Foldkit/Effect versions aligned in the catalog,
update their dependency declarations and lockfile, then install at the
root. Do not upgrade runtime dependencies to refresh prose alone.
With `git subtree` available, refresh from the actually installed release:

```sh
foldkit_version=$(node -p "require('./demo/node_modules/foldkit/package.json').version")
git subtree pull --prefix=repos/foldkit https://github.com/foldkit/foldkit.git \
  "foldkit@$foldkit_version" --squash
cp repos/foldkit/packages/create-foldkit-app/templates/base/FOLDKIT.md FOLDKIT.md
```

For the initial import, use `git subtree add` with the same prefix, ref
and `--squash`. Apple Git may omit subtree; use the official Git
`contrib/subtree/git-subtree.sh` matching your Git version on PATH as
`git-subtree`. Do not substitute a copy from main for a release tag.
Canary versions have no release tag: resolve the full commit encoded in
the installed version and pin that commit instead.

Update the pin/commit/tree table and AGENTS.md, check that the release
still ships all three skill directories, and compare the installed
plugin's declarations with its vendored source. Match the MCP server
version to `repos/foldkit/packages/devtools-mcp/package.json`, update the
demo development dependency and freeze the lockfile. Refresh the Effect
skill separately and deliberately when its reviewed APIs match the
installed Effect release; its provenance lives in `repos/effect-skill/`.
Run pin/link checks, `pnpm check` and the DevTools smoke below.

## DevTools MCP

The installed **@foldkit/vite-plugin 0.26.1** declares
`foldkit(options?: FoldkitPluginOptions)` with
`devToolsMcpPort?: number | false`. The existing `foldkit()` call in
`demo/vite.config.ts` enables automatic discovery: the plugin publishes
a token-protected WebSocket relay address for its `demo/` root. Keep
that default. No guessed `mcp` or `devTools` plugin option is needed.

The root [.mcp.json](../.mcp.json) starts the pinned demo-owned server with:

```sh
pnpm --filter @foldkit-dials/demo exec foldkit-devtools-mcp
```

The command runs in `demo/`, so discovery targets the demo rather than
another checkout's Vite server. MCP hosts that do not read `.mcp.json`
should register this same stdio command/argument list with the repository
root as their working directory. Restart the MCP host after the first
frozen install or a config change. Start `pnpm dev` and open the demo in
a browser: no browser tab means no connected Runtime.

Smoke-test through the connected MCP tools:

1. `foldkit_list_runtimes` must find the demo's live Runtime.
2. Use its `runtime_id` with `foldkit_get_model` and
   `foldkit_get_runtime_state`; both must return live state.
3. `foldkit_get_message_schema` must return a configured Schema result.
   This release returns an empty variant index for the composed
   `Schema.Union` produced by DialPanel.attach. Use `demo/src/main.ts`
   and the library's `dialPanel/attach.ts` for Message shapes until the
   release supports that index. `demo/src/entry.ts` supplies
   `program.Message`, so dispatch still validates both app and panel
   Messages. A valid `UpdatedReducedMotion` with `isReducedMotion: false`
   is accepted; an unknown `_tag` is rejected.
4. Interact with the demo and use `foldkit_list_messages` to verify the
   corresponding Message. Stop the browser and dev server afterward.

The retained `serveDevToolsHostFromSource` workaround in the Vite config
keeps the overlay on the same runtime copy for plugin 0.26.1. Remove it
only after verifying a release fixes that issue. DevTools UI is shown in
the deployed demo by design; the MCP relay runs only in development.

For discovery troubleshooting, read the release's
`packages/devtools-mcp/README.md`, `src/relayLocation.ts` and the installed
plugin's `dist/index.d.ts`. `FOLDKIT_PROJECT_ROOT` overrides the search
root; `FOLDKIT_DEVTOOLS_RELAY_DIRECTORY` must match in Vite and MCP when
their sandboxes use different registry locations. On macOS, an MCP host
that strips `TMPDIR` can search a different OS temporary directory than
Vite. Preserve the parent environment (for example, `env: process.env`
in an SDK `StdioClientTransport`), or explicitly set the same absolute
`FOLDKIT_DEVTOOLS_RELAY_DIRECTORY` in both processes before starting them.
Retry tools briefly while the MCP server establishes its connection.
Do not copy relay
tokens into tracked configuration or logs. A numeric `devToolsMcpPort`
uses a separate unauthenticated listener on every interface and requires
matching `FOLDKIT_DEVTOOLS_MCP_PORT`; it is not needed for this setup.
`foldkit({ devToolsMcpPort: false })` disables the relay when appropriate.

## Reference isolation

`pnpm-workspace.yaml` lists only `packages/*`, `demo` and `stacks`.
TypeScript and Vitest explicitly include owned paths; the library build
includes its own `src`, and Vite builds from `demo`. All formatter/linter
presets exclude `repos/` and skill-link directories, with explicit root
configs. The formatter preserves canonical FOLDKIT.md. `.ignore` hides
`repos/` from tools that honor editor/search ignores; use explicit paths
or `rg --no-ignore repos/foldkit/...` when reading references.

Imports use installed `foldkit`, `@foldkit/ui` and `effect` packages.
References are for reading only. `pnpm check` verifies owned code; it
must never build, lint, format or install a reference workspace.
