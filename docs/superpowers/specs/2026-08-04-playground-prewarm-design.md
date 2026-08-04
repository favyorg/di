# Playground runtime prewarm and first-load feedback

## Goal

Make the documentation playground feel immediate after its initial background
startup. Syntax highlighting must be visible on the first paint, runtime
preparation must have clear progress, and repeated runs must reuse the same
Vite/Nodebox client instead of reinstalling the dependency graph.

The playground must preserve its current features: explicit execution through
the `Run` button, automatic public-package import detection, editable examples,
draft restoration, reset, console output, keyboard execution, and all bundled
examples including HKT.

## Observed problems

The current Sandpack provider is configured for manual execution. Every call to
`runSandpack()` creates a new Nodebox client, downloads or resolves the package
graph again, and starts Vite again. A cold run takes about eight seconds and an
unchanged repeated run takes roughly four to six seconds.

The editor's server-rendered markup already contains syntax token spans, but it
has no token colours before hydration. In dark mode the server starts with the
light Sandpack theme while the client starts with the dark theme. React retains
the server class during hydration, leaving it without matching generated theme
variables, so highlighting can remain visually absent.

The current running state appears only as small status text and a static dot.
Although the state changes immediately, it does not give enough visual feedback
for a multi-second initial preparation.

## Runtime design

The playground will keep one Sandpack Vite client alive for as long as the
resolved dependency set is unchanged.

Sandpack will start automatically with a private `/runner.ts` entry. During
background preparation that entry imports the detected dependencies, including
`@favy/di`, but never imports or executes the editable `/index.ts` program. This
starts Nodebox and Vite and installs the packages without running user code.

The editor continues to display and edit `/index.ts`. Pressing `Run` takes a
snapshot of that source and updates the existing sandbox through the active
client's `updateSandbox()` method. The updated runner dynamically imports the
snapshot with a unique run token. Changing the token invalidates Vite's module
cache, so every click executes exactly once while retaining the existing Vite
process and installed `node_modules`.

The runner emits a private completion marker in `finally`. Playground code
filters this marker out of the visible console and uses it to finish the current
run. Runtime errors remain visible. A matching token prevents messages from a
superseded execution from completing the wrong run, and a bounded timeout
prevents the controls from remaining busy forever if the sandbox disappears.

Changing examples, restoring a draft, or resetting an example does not remount
the provider when the dependency signature is unchanged. A genuinely changed
valid dependency set creates one new provider and prewarms it. Incomplete
imports retain the last valid set, as they do today.

## Run queue and state model

Runtime readiness is independent from import scanning and execution. The UI
derives its message from these states:

- `Loading editor` while the client-side editor is hydrating;
- `Preparing runtime` while packages or Vite are starting;
- `Ready` when the persistent client can accept a run;
- `Running` after a source snapshot has been sent;
- `Failed` when preparation or execution cannot complete.

Sandpack dependency and shell progress messages refine the preparation label,
for example `Downloading packages`, `Installing packages`, or `Starting Vite`.
The `Run` button shows the active label and an animated spinner instead of a
small static indicator.

If the user presses `Run` before preparation finishes, the playground stores
that click's source snapshot, shows `Preparing runtime`, disables duplicate run
requests, and executes the snapshot once as soon as the client is ready. If an
immediate import scan finds a different valid dependency signature, the queued
request waits for the replacement client. User code is never executed merely by
opening the page or changing examples.

## Syntax highlighting on first load

Sandpack theme selection must begin from the same deterministic value during
server rendering and client hydration. After hydration, an effect synchronizes
the editor with the document's actual light or dark theme and responds to later
theme changes.

The server-rendered playground receives a small scoped fallback palette for
Sandpack syntax token classes. It is active only while the React island still
has its `ssr` marker, so code is coloured on the first paint and Sandpack's
generated theme takes over after hydration without competing styles.

## Console behavior

Each accepted run starts a fresh visible output segment so output from an older
run is not mistaken for the current result. Internal readiness and completion
markers are never shown. Normal `console` output, TypeScript diagnostics,
dependency errors, and runtime exceptions retain their current presentation.

## Verification

Tests will cover the behavior before implementation changes:

1. The provider remains mounted across example changes and resets when the
   dependency signature is unchanged.
2. Background preparation does not execute `/index.ts`.
3. A click during preparation is queued and executes exactly once after ready.
4. A ready run uses `updateSandbox()` and a unique token instead of
   `runSandpack()`.
5. Progress messages and completion markers drive visible states and private
   markers do not reach the console.
6. The initial theme is hydration-safe and first-paint token fallback styles are
   present.
7. Browser verification confirms a successful cold run, then two unchanged
   warm runs using the same Nodebox frame with no repeated npm registry traffic.

The warm-run target is below 200 ms on the local verification machine; the
observed prototype completed in approximately 84 ms and 56 ms. The docs test,
type-check, and production build must also pass.

