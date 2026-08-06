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
dependency session prepares through a fresh dedicated module Worker, and each
Run uses a separate fresh dedicated module Worker. The persistent runner creates
the Worker from `/runtime-worker.ts` with `type: "module"` and omitted
credentials. A warmup Worker imports `/warmup.ts`; an execution Worker imports
the tokened `/execution.ts` snapshot. The warmup Worker is terminated after
readiness or failure, and the execution Worker is terminated after completion,
cancellation, or replacement. Sandpack may download and transform registry
packages, but module evaluation never happens in the persistent runner realm.

The earlier opaque nested `/frame.html` transport is not viable in Nodebox. A
browser check verified that an iframe sandboxed without `allow-same-origin` is
not controlled by the preview service worker: its navigation bypasses the
virtual Vite graph and reaches the Nodebox edge as a 404. A `srcdoc` variant has
an opaque `Origin: null` and its module fetches fail CORS instead. Adding CORS
headers inside the virtual Vite server cannot fix requests that never reach
that server. A module Worker created by the preview client remains on the
service-worker-controlled Nodebox graph and can therefore load the entry and
its transitive imports.

The Worker is a fresh JavaScript realm without DOM globals such as `window`,
`document`, `parent`, or `localStorage`, so user code cannot directly reach the
playground page or the persistent runner's global object. This is a lifecycle
and capability boundary, not an opaque-origin security boundary: the Worker
executes on the randomized Nodebox preview origin, and origin storage APIs that
exist in workers remain in that origin's scope. The preview origin is treated
as disposable runtime infrastructure, not as trusted durable storage. This
design does not claim to contain deliberately hostile code.

Workers report readiness, console records, errors, and completion through their
dedicated `postMessage()` channel. The outer runner accepts a message only when
all of the following match the current `ActiveWorker` and that message's token
domain:

- the listener belongs to the exact Worker that is still active;
- the message has the expected discriminator and exact session token, plus the
  exact run token for execution messages;
- the method is one of the supported console/completion/error methods;
- the payload has the expected bounded shape.

The protocol has two token domains. A dependency-session token identifies one
Sandpack provider generation and its warmup; each click receives a separate
run token that is unique within that session. `prepare(sessionToken)` creates
the warmup Worker. `run(sessionToken, runToken)` and
`cancel(sessionToken, runToken)` address only one execution. The warmup Worker's
`ready` or `prepareError` carries the session token; the execution Worker's
`output`, `error`, and `complete` carry both tokens. The outer runner itself
emits tokened `cancelled` after terminating a matching execution Worker. It
validates child messages, then relays bounded records and acknowledgements
through its Sandpack console channel to React.

`cancel` terminates the matching execution Worker, removes its listener, and
acknowledges cleanup. Cancelling a queued request is local because no execution
Worker exists;
cancelling a commit invalidates the run token so a late `fs/change` is ignored.
Reset with the same dependencies leaves useful background warmup intact, while
navigation to a different dependency signature destroys the whole session.
Late messages are ignored after either token or Worker is replaced. Creating a
replacement Worker first terminates the previous one. If an active execution
cancellation is not acknowledged within one second, React hard-remounts the
outer runtime. Normal completion terminates its Worker but never remounts the
outer runtime.

A Run click captures the exact editor source and dependency signature. Its state
machine is explicit:

1. `queued` waits for `ready` from the current session token. Preparation has a
   120-second watchdog, not the execution timeout.
2. `committing` writes the captured source to `/execution.ts` and waits at most
   10 seconds for the exact Sandpack `fs/change` acknowledgement.
3. `executing` begins when the tokened `run` command is sent and has a
   30-second watchdog covering Worker module loading, compilation, and
   execution.

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
do not claim to prevent a deliberately hostile Worker from consuming browser
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
  creates a fresh module Worker for warmup and each execution, validates both
  token domains plus source/type/shape, and terminates the Worker after every
  terminal outcome, cancellation, or replacement;
- a real browser loads an external transitive module graph through the Nodebox
  preview service worker, while executed code observes no `window`, `document`,
  `parent`, or `localStorage` globals; the same coverage records that an opaque
  nested frame bypasses that virtual graph instead of treating CORS as a viable
  fallback;
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
- two warm runs reuse the same outer iframe while each uses a fresh Worker,
  perform no package reinstall, and complete below a conservative 1,000 ms CI
  ceiling. The locally observed time is reported separately and should remain
  around the current 30–40 ms.

Unit tests, TypeScript checks, the production docs build, the clean-install CI
path, and the browser smoke must all pass before the branch is considered
merge-ready.

## Non-goals

- Publishing a new npm version solely for the playground.
- Removing external-package auto-imports, the Run button, examples, drafts,
  Monaco hover, or the standalone route.
- Adding a server-side container backend or supporting hostile server-side
  code.
- Broadly redesigning the page or refactoring unrelated documentation code.
- Trading persistent warm performance for a full Sandpack remount on every Run.
