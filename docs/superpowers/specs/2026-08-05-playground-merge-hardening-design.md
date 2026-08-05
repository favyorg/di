# Playground Merge Hardening Design

**Date:** 2026-08-05
**Status:** Draft for written review; architecture approved in chat

## Goal

Make the standalone `/playground/` safe and reliable enough to merge without
changing its current UI, examples, automatic dependency loading, type hover, or
fast warm-run behavior.

The implementation must close the verified merge blockers:

- user code currently runs in a same-origin iframe and can reach the persistent
  runtime;
- the editor uses the checked-out `@favy/di` sources while execution installs
  the older public `@favy/di@3.0.0` artifact;
- dependency parsing can accept a package name that runtime warmup rejects and
  crash React rendering;
- a Run queued during cold preparation is silently discarded after 30 seconds;
- output and source growth are not bounded at the component boundary;
- auto-typings can outlive an editor generation;
- a clean CI job neither installs the docs dependencies nor runs the browser
  smoke test, and the workflow is outside GitHub's discovery directory.

## Scope and File Responsibilities

Keep `playground.tsx` responsible for examples, drafts, navigation, the editor,
and visible status/output. Extract only the Sandpack provider and runtime
lifecycle into `playground-sandbox.tsx`. Runtime source generation stays in
`playground-runtime.ts`, and import parsing stays in
`playground-dependencies.ts`.

This is a targeted split, not a component rewrite or a new abstraction layer.
`PlaygroundSandbox` receives the dependency session and queued run, renders its
visible workspace children inside `SandpackProvider`, and emits ready, status,
bounded-output, and settled events. A provider-scoped controller renders only
the hidden client iframe and owns file commits, protocol messages, watchdogs,
and cleanup. No editor, picker, toolbar, or console markup moves into the
controller file.

## Dependency Resolution and the Local Library Artifact

One exported npm-package-name validator is shared by dependency resolution and
runtime warmup. It accepts valid scoped and unscoped npm package names up to 214
characters and rejects malformed bare specifiers such as `_hidden`, incomplete
scopes, and invalid query-like package roots. Resolution has three explicit
outcomes: ready dependencies, an incomplete edit pending the next scan, or an
unsupported bare specifier carrying its source text. When several specifiers
are unsupported, the first in source order is reported deterministically. An
unsupported specifier never reaches `warmupSource()`. The UI keeps the code
editable, disables Run, and shows `Unsupported import: <specifier>` until it is
corrected; an incomplete edit retains the previous prepared runtime and shows
the existing checking state.

`@favy/di` is a built-in playground dependency, not a registry dependency. The
four checked-out source files already supplied to Monaco are also mounted as
hidden Sandpack files under `/favy-di/`. The Sandpack Vite config aliases
`@favy/di` to `/favy-di/index.ts`, and `@favy/di` is excluded from
`customSetup.dependencies`. External valid packages continue to use the
existing one-second idle scan and are installed as `latest`.

This gives editor diagnostics, hover, execution, tests, and the branch under
review one exact library implementation. The browser test must also prove that
running bundled examples does not request `@favy/di` from the registry.

## Execution Isolation and Lifecycle

The outer Sandpack/Nodebox runtime remains persistent between successful runs,
but it never statically imports or evaluates user-selected dependencies. A
dependency session prepares through a disposable hidden warmup iframe, and each
Run uses a separate fresh execution iframe. Both frames use
`sandbox="allow-scripts"` without `allow-same-origin`, so user code and imported
package code execute only in opaque-origin documents and cannot read or mutate
the outer runtime or the playground page. Sandpack may download and transform
registry packages, but module evaluation never happens in its privileged
runner realm.

The frames navigate to a hidden `/frame.html` served by the Sandpack Vite
runtime. Its inline bootstrap reads a validated mode and token and dynamically
imports either `/warmup.ts` or `/execution.ts`. Vite is configured to return
`Access-Control-Allow-Origin: *` for the entry and every transitive module;
module requests use no credentials, allowing an opaque `Origin: null` document
to load the graph. The warmup entry imports the exact dependency graph only in
its disposable frame, reports readiness, and is then removed. This URL-based
transport is the required design; Blob URLs and `allow-same-origin` are not
fallbacks.

The children report readiness, console records, errors, and completion through
`parent.postMessage()`. The outer runner accepts a message only when all of the
following match the active frame and that message's token domain:

- `event.source` is the current child window;
- the message has the expected discriminator and exact session token, plus the
  exact run token for execution messages;
- the method is one of the supported console/completion/error methods;
- the payload has the expected bounded shape.

The protocol has two token domains. A dependency-session token identifies one
Sandpack provider generation and its warmup; each click receives a separate
run token that is unique within that session. `prepare(sessionToken)` creates
the warmup frame. `run(sessionToken, runToken)` and
`cancel(sessionToken, runToken)` address only one execution. The warmup frame's
`ready` or `prepareError` carries the session token; the execution frame's
`output`, `error`, and `complete` carry both tokens. The outer runner itself
emits tokened `cancelled` after removing a matching execution frame. It
validates child messages, then relays bounded records and acknowledgements
through its Sandpack console channel to React.

`cancel` removes the matching execution frame and listener and acknowledges
cleanup. Cancelling a queued request is local because no execution frame exists;
cancelling a commit invalidates the run token so a late `fs/change` is ignored.
Reset with the same dependencies leaves useful background warmup intact, while
navigation to a different dependency signature destroys the whole session.
Late messages are ignored after either token or frame is replaced. If an active
execution cancellation is not acknowledged within one second, React
hard-remounts the outer runtime. Normal completion never remounts it.

A Run click captures the exact editor source and dependency signature. Its state
machine is explicit:

1. `queued` waits for `ready` from the current session token. Preparation has a
   120-second watchdog, not the execution timeout.
2. `committing` writes the captured source to `/execution.ts` and waits at most
   10 seconds for the exact Sandpack `fs/change` acknowledgement.
3. `executing` begins when the tokened `run` command is sent and has a
   30-second watchdog covering child navigation, compilation, and execution.

A preparation error, preparation timeout, or commit timeout hard-remounts the
outer runtime with a new session token and retries the same run token and
not-yet-executed snapshot once. A second failure settles it as
`Failed — runtime unavailable`. An execution timeout is never retried, because
user side effects may already have happened; it settles as
`Failed — runtime restarted` and hard-remounts the runtime. A request that waits
more than 30 seconds but less than the preparation watchdog still launches once
when ready.

Run remains disabled while a request is queued, committing, or executing.
Reset and example navigation remain available. They use the phase-specific
local invalidation, run cancellation, or session destruction described above,
then apply the requested draft change. The current draft is preserved across
infrastructure remounts.

## Resource Limits

The source limit is an execution and dependency-scan boundary, not an editor
storage limit: the controlled draft stays editable in React, but its UTF-8 size
is checked before Babel parsing, type acquisition, Sandpack updates, or Run.
Visible error precedence is oversized source, unsupported import, incomplete
edit, then runtime state.

Output limits are enforced in the outer controller before records reach React
console state:

- maximum source size: 64 KiB of UTF-8;
- maximum console records retained per run, including the truncation notice:
  200;
- maximum console arguments per call: 20;
- maximum accepted serialized user-console payload per run: 64 KiB;
- the existing per-value depth, visit, string, and serialized-value limits stay
  in force.

An oversized source disables Run with `Source is too large (64 KiB maximum)`.
For output, at most 199 accepted unique user events are processed; `clear` may
make the retained record count smaller. The first later event or byte overflow
appends `[Output truncated]` as the next and final visible record, so output
contains at most 200 records even when overflow happens early. This fixed UI
notice is excluded from the 64 KiB user-payload budget.
Completion and cancellation messages do not count. Invalid and duplicate
messages are ignored before accounting. A
`console.clear()` call counts toward the cumulative record/UTF-8 byte budgets
and clears displayed lines, but never resets counters or de-duplication state.
Calls with too many arguments retain the first 19 plus the existing
`[Truncated]` value as the twentieth argument. Errors use the same budgets.
The de-duplication set stores only accepted identifiers and is therefore capped
at 200 entries and cleared with the run.

These limits bound legitimate console data retained by the application; they
do not claim to prevent a deliberately hostile iframe from consuming browser
CPU or structured-clone work before a rejected message reaches validation.

## Editor Typings, Focus, and Accessibility

The existing validated one-second dependency scan remains the only trigger for
external type acquisition. Mount and dependency-version changes start a new
generation; ordinary keystrokes do not. `AutoTypings.create()` uses
`dontRefreshModelValueAfterResolvement: true`, and its content-change listener
is disposed immediately after construction because acquisition has already
captured the current model synchronously.

Each generation receives guarded `SourceResolver` and `SourceCache` adapters.
Its custom fetch resolver owns an `AbortController`; invalidation aborts those
requests, makes late resolver and cache reads return no content, and makes late
cache writes no-ops. It also
receives a generation-scoped Monaco facade whose `editor.createModel` checks the
generation at the final write boundary, rejects stale calls, and records every
model created by that generation. Invalidation disposes those owned package
models before the next acquisition, while pre-existing models that the
generation did not create are left alone. Together these guards prevent the
library's await gap from creating stale versionless declarations and prevent a
completed old version from blocking the next exact version at the same Monaco
URI. The playground's one-second scan is the only debounce; the library's
internal edit debounce is not used.

An outer runtime restart does not remount Monaco. If an infrastructure change
does replace the editor while keeping the same draft, selection is restored.
Focus is restored only when a focus-generation guard proves that removing the
outgoing editor caused focus loss; any intervening `focusin` cancels restoration.
Reset and example navigation intentionally use their normal new-draft focus
behavior.

The server-rendered syntax fallback puts Sandpack's unnamed internal tabpanel in
an `aria-hidden` visual subtree and exposes a separate sibling element as one
focusable read-only textbox named `TypeScript playground editor`. The toolbar
uses a separate `isBusy` flag for `aria-busy`; invalid or oversized code
disables Run without claiming work is in progress. The theme button uses the
stable name `Dark theme` with `aria-pressed` reflecting the current dark state.
Existing names for the example picker, Run, status, and console remain
unchanged.

## CI, Documentation, and Repository Integration

Move the workflow to `.github/workflows/ci.yml` and remove the undiscovered
`workflows/ci.yml`. CI uses Node 20, caches both lockfiles, runs `npm ci` in the
repository root and in `docs`, then runs the existing affected lint/test/build
tasks.

Add docs `test` and `smoke` package scripts. Keep the test target inferred by
the existing Nx Jest plugin and add only the missing explicit smoke target. The
smoke runner starts an Astro preview on a fixed CI-local port, polls until it is
ready, launches Playwright's bundled Chromium, and always terminates the preview
process. CI installs that Chromium, builds docs explicitly, and then runs the
smoke. It does not depend on a machine-installed Chrome channel.

Add the standalone Playground link to the root README. Mark the older
interactive-playground design as superseded where it describes a visible
Sandpack editor or obsolete manual-run behavior, linking to the newer prewarm,
type-hover, standalone, and hardening designs instead of rewriting history.

## Verification

Implementation proceeds test-first and covers these boundaries:

- dependency resolution and warmup share acceptance rules for scoped,
  unscoped, malformed, query-like, and overlength names;
- invalid imports and oversized source produce stable visible states without a
  render exception;
- the deployed `runtimeSource()` path has no privileged dependency imports,
  creates opaque warmup and execution frames, validates both token domains plus
  source/type/shape, and cleans up after every terminal outcome;
- a real browser loads an external transitive module graph from `Origin: null`
  through the configured CORS transport, while sandboxed code cannot read the
  outer runtime;
- a request that waits longer than 30 seconds for readiness still runs its
  captured snapshot once; commit, cancel, and execution watchdog tests cover
  late acknowledgements and remount only on their specified failure paths;
- source, argument, record, byte, and de-duplication limits add one truncation
  notice and stay bounded;
- editor unmount/version-change tests reject stale resolver/cache/model writes,
  dispose generation-owned models, and verify conditional focus restoration;
- Sandpack uses the checked-out local library files and never installs
  `@favy/di` from npm;
- browser smoke runs all six examples, checks type hover and both themes, and
  verifies the standalone page's accessibility and responsive behavior;
- two warm runs reuse the same outer iframe, perform no dependency reload, and
  complete below a conservative 1,000 ms CI ceiling. The locally observed time
  is reported separately and should remain around the current 30–40 ms.

Unit tests, TypeScript checks, the production docs build, the clean-install CI
path, and the browser smoke must all pass before the branch is considered
merge-ready.

## Non-goals

- Publishing a new npm version solely for the playground.
- Removing external-package auto-imports, the Run button, examples, drafts,
  Monaco hover, or the standalone route.
- Adding a worker/container backend or supporting hostile server-side code.
- Broadly redesigning the page or refactoring unrelated documentation code.
- Trading persistent warm performance for a full Sandpack remount on every Run.
