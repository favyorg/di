# Playground Merge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone Playground safe, exact to the checked-out `@favy/di` implementation, bounded, lifecycle-correct, and enforced by clean CI without changing its examples or warm-run UX.

**Architecture:** Keep drafts, navigation, editor, toolbar, and console presentation in `playground.tsx`; move the Sandpack provider and runtime state machine into `playground-sandbox.tsx`. A persistent Sandpack client manages disposable opaque warmup/execution frames through a two-token protocol, while generation-scoped Monaco type acquisition and a self-hosted browser smoke close the remaining editor and CI races.

**Tech Stack:** TypeScript 5.7, React 18, Astro 4, Sandpack 2.20, Vite, Monaco 0.52, `monaco-editor-auto-typings` 0.4.6, Jest 29, Playwright 1.49, Nx 19, GitHub Actions.

## Global Constraints

- Preserve `/playground/`, all six examples, drafts, automatic external-package loading after one second idle, Monaco hover, the Run button, and the current visual design.
- Mount the four checked-out `@favy/di` TypeScript files in Sandpack and never install or execute the public npm artifact.
- Run user code and imported package code only in an iframe with exactly `sandbox="allow-scripts"`; never add `allow-same-origin` and never use a Blob fallback.
- The privileged `/runner.ts` may manage frames but must not import or evaluate user-selected packages.
- Use `/frame.html` plus Vite CORS `Access-Control-Allow-Origin: *` for credentialless opaque-origin module loading.
- Use a dependency-session token for warmup and a separate run token for every click.
- Preparation, commit, execution, and active-cancellation watchdogs are exactly 120,000 ms, 10,000 ms, 30,000 ms, and 1,000 ms.
- Retry a not-yet-executed snapshot once after preparation/commit infrastructure failure; never retry an execution timeout.
- Accept source up to 65,536 UTF-8 bytes; keep oversized source editable but do not parse, type-acquire, send, or run it.
- Process at most 199 unique user console events, retain at most 200 visible records including one `[Output truncated]` notice, accept at most 65,536 UTF-8 payload bytes, and accept at most 20 arguments per call.
- Keep the existing per-value depth, visit, string, and serialized-value limits.
- Preserve the same outer runtime iframe across successful runs and keep two warm runs under the conservative 1,000 ms CI ceiling; report the local 30–40 ms baseline separately.
- Use the app's validated one-second dependency scan as the only typings debounce.
- Use Playwright's bundled Chromium and Node 20 in CI; do not depend on a machine-installed Chrome channel.
- Keep the extraction targeted: no example rewrite, page redesign, unrelated docs refactor, new runtime backend, or npm publish.
- Do not use or terminate the user's server on port 4321. The managed smoke wrapper uses port 4399 unless `DOCS_SMOKE_PORT` overrides it.
- Never stage `.superpowers/` and never add a Codex/Anthropic co-author trailer.

## File Map

- Create `docs/src/components/playground/favy-di-sources.ts`: one manifest for the four raw local files consumed by Monaco and Sandpack.
- Create `docs/src/components/playground/playground-sandbox.tsx`: Sandpack provider, hidden client, session generation, run lifecycle, timers, cancellation, output budgets, and callbacks.
- Create `docs/src/components/typescript-editor-typings.ts`: cancellable generation wrappers for resolver, cache, and Monaco model ownership.
- Create `docs/scripts/run-docs-smoke.mjs`: managed preview startup, readiness polling, smoke invocation, and teardown.
- Create `docs/test/playground-sandbox.spec.tsx`: isolated controller/lifecycle tests.
- Create `docs/test/typescript-editor-typings.spec.ts`: generation-race tests.
- Create `docs/test/repository-integration.spec.ts`: scripts, Nx target, workflow, and output-path contract.
- Create `.github/workflows/ci.yml` and delete `workflows/ci.yml`: discoverable clean CI.
- Modify `docs/src/components/playground/playground-dependencies.ts`: shared package-name domain and three explicit resolution variants.
- Modify `docs/src/components/playground/playground-runtime.ts`: opaque-frame sources, protocol, relay parsing, execution setup, and limits.
- Modify `docs/src/components/playground/playground.tsx`: presentation, source validation, pending UI transitions, and sandbox callbacks.
- Modify `docs/src/components/playground/playground.css`: accessible fallback states only.
- Modify `docs/src/components/typescript-editor.tsx`: shared local sources, typings generations, and conditional focus restore.
- Modify `docs/src/pages/playground.astro`: stable toggle semantics.
- Modify `docs/test/playground-dependencies.spec.ts`, `docs/test/playground-runtime.spec.ts`, `docs/test/playground.spec.tsx`, and `docs/test/typescript-editor.spec.tsx`: focused regressions.
- Modify `docs/scripts/docs-pages-smoke.mjs`: bundled Chromium, opaque CORS/security checks, local artifact checks, accessibility, and performance.
- Modify `docs/package.json`, `docs/project.json`, and `nx.json`: test/smoke scripts, smoke target, and real Astro output.
- Modify `README.md`: add the public Playground link.
- Modify `docs/superpowers/specs/2026-08-04-interactive-playground-design.md`: mark obsolete editor/run descriptions as superseded.

---

### Task 1: Align import resolution and mount the checked-out library

**Files:**
- Create: `docs/src/components/playground/favy-di-sources.ts`
- Modify: `docs/src/components/playground/playground-dependencies.ts`
- Modify: `docs/src/components/playground/playground-runtime.ts`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/src/components/typescript-editor.tsx`
- Modify: `docs/test/playground-dependencies.spec.ts`
- Modify: `docs/test/playground-runtime.spec.ts`
- Modify: `docs/test/playground.spec.tsx`
- Modify: `docs/test/typescript-editor.spec.tsx`

**Interfaces:**
- Produces:

```ts
export type PlaygroundDependencyVersion = 'local' | 'latest';
export type DependencyResolution =
  | { readonly kind: 'ready'; readonly dependencies: PlaygroundDependencies }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'unsupported'; readonly specifier: string };

export const isNpmPackageName: (name: string) => boolean;
export const resolvePlaygroundDependencies: (
  source: string
) => DependencyResolution;

export type FavyDiSourceFile = Readonly<{
  packagePath: `src/${string}.ts`;
  sandboxPath: `/favy-di/${string}.ts`;
  code: string;
}>;
export const favyDiSourceFiles: readonly FavyDiSourceFile[];
```

- `PlaygroundDependencies` retains `@favy/di: 'local'` as a built-in signature marker. Sandpack registry dependencies contain only entries whose version is `latest`.

- [ ] **Step 1: Add failing resolver and warmup-domain tests**

Replace `{ ok: ... }` assertions with `kind` variants and add:

```ts
it.each([
  ['-foo', true],
  ['@scope/-foo', true],
  ['@-scope/foo', true],
  ['a'.repeat(214), true],
  ['_hidden', false],
  ['pkg?raw', false],
  ['@scope', false],
  ['a'.repeat(215), false],
])('uses one warmup-safe package domain for %s', (name, valid) => {
  expect(isNpmPackageName(name)).toBe(valid);
  if (valid) expect(warmupSource([name])).toBe(`import ${JSON.stringify(name)};`);
  else expect(() => warmupSource([name])).toThrow(TypeError);
});

it('returns the first unsupported bare specifier in source order', () => {
  expect(
    resolvePlaygroundDependencies("import '_hidden'; import 'pkg?raw';")
  ).toEqual({ kind: 'unsupported', specifier: '_hidden' });
});

it('distinguishes incomplete edits from unsupported bare specifiers', () => {
  expect(resolvePlaygroundDependencies("import value from '")).toEqual({
    kind: 'incomplete',
  });
  expect(resolvePlaygroundDependencies("import '_hidden';")).toEqual({
    kind: 'unsupported',
    specifier: '_hidden',
  });
  expect(
    resolvePlaygroundDependencies("import '_hidden'; import value from '")
  ).toEqual({ kind: 'unsupported', specifier: '_hidden' });
});

it('never resolves a dependency that warmup rejects', () => {
  const result = resolvePlaygroundDependencies(
    "import '@favy/di'; import '@scope/pkg/subpath'; import 'lodash/fp';"
  );
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error('expected ready dependencies');
  expect(() => warmupSource(Object.keys(result.dependencies))).not.toThrow();
});
```

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-dependencies.spec.ts \
  docs/test/playground-runtime.spec.ts
```

Expected: FAIL because `isNpmPackageName` and the variants do not exist and `_hidden` still crosses into warmup.

- [ ] **Step 3: Implement one classifier and shared validator**

Keep the current parser/token recovery and replace only package classification/result assembly:

```ts
const PACKAGE_NAME =
  /^(?:@[-A-Za-z\d][A-Za-z\d._~-]*\/)?[-A-Za-z\d][A-Za-z\d._~-]*$/;

export const isNpmPackageName = (name: string): boolean =>
  name.length <= 214 && PACKAGE_NAME.test(name);

type PackageSpecifier =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'package'; readonly name: string }
  | { readonly kind: 'unsupported'; readonly specifier: string };

const classifySpecifier = (specifier: string): PackageSpecifier => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    URI_SCHEME.test(specifier)
  ) return { kind: 'ignored' };

  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
    : parts[0];
  return isNpmPackageName(name)
    ? { kind: 'package', name }
    : { kind: 'unsupported', specifier };
};
```

Classify every successfully parsed or recovered specifier in source order. Return
the first recovered `unsupported` result before considering incomplete trailing
syntax; return `incomplete` only when recovery is unfinished and no recovered
specifier is unsupported. Otherwise build the sorted map with
`@favy/di: 'local'`. Import this validator into `playground-runtime.ts` and
delete its duplicate regex.

- [ ] **Step 4: Add failing local-source and component boundary tests**

```ts
expect(favyDiSourceFiles.map(({ packagePath, sandboxPath }) => [
  packagePath,
  sandboxPath,
])).toEqual([
  ['src/index.ts', '/favy-di/index.ts'],
  ['src/lib/hkt.ts', '/favy-di/lib/hkt.ts'],
  ['src/lib/makeModule.ts', '/favy-di/lib/makeModule.ts'],
  ['src/lib/module.ts', '/favy-di/lib/module.ts'],
]);

it('shows an unsupported import without remounting or throwing', () => {
  renderReadyPlayground();
  const mounts = mountEvents();
  fireEvent.change(editor(), { target: { value: "import '_hidden';" } });
  act(() => jest.advanceTimersByTime(1_000));
  expect(screen.getByRole('status').textContent).toContain(
    'Unsupported import: _hidden'
  );
  expect(
    (screen.getByRole('button', { name: 'Run code' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(mountEvents()).toEqual(mounts);
  expect(updateEvents()).toHaveLength(0);
});
```

Also assert an incomplete edit keeps the prepared provider mounted, shows `Checking imports`, and disables Run.

- [ ] **Step 5: Create the manifest and wire current Monaco/Sandpack consumers**

Move the four raw imports into `favy-di-sources.ts`. Monaco registers `packagePath` under `file:///node_modules/@favy/di/`; current `SandboxSession` mounts every `sandboxPath` as `{ code, hidden: true }`.

```ts
const registryDependencies = Object.fromEntries(
  Object.entries(dependencies).filter(([, version]) => version === 'latest')
);
const localFiles = Object.fromEntries(
  favyDiSourceFiles.map(({ sandboxPath, code }) => [
    sandboxPath,
    { code, hidden: true },
  ])
);
```

Set Vite's exact alias with `find: /^@favy\/di$/` and replacement `/favy-di/index.ts`; warmup may import `@favy/di`, which now resolves locally. Update every resolver consumer to branch on `kind` and never call `warmupSource` from render for an invalid result.

- [ ] **Step 6: Run resolver, editor, component, type, and build verification**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-dependencies.spec.ts \
  docs/test/playground-runtime.spec.ts \
  docs/test/typescript-editor.spec.tsx \
  docs/test/playground.spec.tsx
npx tsc -p docs/tsconfig.spec.json --noEmit
npm --prefix docs run build
```

Expected: PASS; all four local files are mounted, registry setup excludes `@favy/di`, and no example changes.

- [ ] **Step 7: Commit the invariant and local artifact**

```bash
git add docs/src/components/playground/favy-di-sources.ts \
  docs/src/components/playground/playground-dependencies.ts \
  docs/src/components/playground/playground-runtime.ts \
  docs/src/components/playground/playground.tsx \
  docs/src/components/typescript-editor.tsx \
  docs/test/playground-dependencies.spec.ts \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground.spec.tsx \
  docs/test/typescript-editor.spec.tsx
git commit -m "fix(docs): align playground imports with local runtime"
```

---

### Task 2: Define the opaque two-token runtime protocol

**Files:**
- Modify: `docs/src/components/playground/playground-runtime.ts`
- Modify: `docs/src/components/playground/playground.tsx` (temporary legacy aliases only)
- Modify: `docs/test/playground-runtime.spec.ts`

**Interfaces:**
- Produces:

```ts
export type PlaygroundConsoleValue =
  | string
  | number
  | boolean
  | null
  | undefined;
export type RuntimeConsoleMethod =
  | 'assert'
  | 'clear'
  | 'count'
  | 'debug'
  | 'error'
  | 'info'
  | 'log'
  | 'table'
  | 'time'
  | 'timeEnd'
  | 'warn';

export type RuntimeCommand =
  | Readonly<{ type: '__FAVY_PLAYGROUND_RUNTIME__'; action: 'prepare';
      sessionToken: number }>
  | Readonly<{ type: '__FAVY_PLAYGROUND_RUNTIME__'; action: 'run' | 'cancel';
      sessionToken: number; runToken: number }>;

export type RuntimeRelay =
  | { kind: 'ready'; sessionToken: number }
  | { kind: 'prepareError'; sessionToken: number; error: PlaygroundConsoleValue }
  | { kind: 'output'; sessionToken: number; runToken: number; eventId: number;
      method: RuntimeConsoleMethod; data: readonly PlaygroundConsoleValue[] }
  | { kind: 'error'; sessionToken: number; runToken: number; eventId: number;
      error: PlaygroundConsoleValue }
  | { kind: 'complete'; sessionToken: number; runToken: number }
  | { kind: 'cancelled'; sessionToken: number; runToken: number };

export const runtimePrepareCommand: (sessionToken: number) => RuntimeCommand;
export const runtimeRunCommand: (sessionToken: number, runToken: number) => RuntimeCommand;
export const runtimeCancelCommand: (sessionToken: number, runToken: number) => RuntimeCommand;
export const runtimeRelayRecord: (record: ConsoleRecord) => RuntimeRelay | undefined;
export const runtimeSource: () => string;
export const frameHtmlSource: () => string;
export const setupForRun: (
  setup: SandboxSetup,
  code: string,
  sessionToken: number,
  runToken: number
) => SandboxSetup;
```

- [ ] **Step 1: Replace same-origin tests with failing opaque protocol tests**

Keep value-normalization cases but execute the inline bootstrap extracted from
`frameHtmlSource()`. Add runner assertions:

```ts
expect(runtimeSource()).not.toMatch(/^\s*import\s/m);
expect(runtimeSource()).not.toContain('allow-same-origin');
expect(runtimeSource()).not.toMatch(/\bBlob\b|blob:/);
dispatch(runtimePrepareCommand(11));
const warmup = document.querySelector<HTMLIFrameElement>(
  'iframe[data-favy-playground-warmup="11"]'
);
expect(warmup?.getAttribute('sandbox')).toBe('allow-scripts');
expect(warmup?.src).toContain('/frame.html?mode=warmup&session=11');
dispatch(runtimeRunCommand(11, 7));
expect(executionFrameOrNull()).toBeNull();
emitReadyFrom(warmup!, 11);
dispatch(runtimeRunCommand(11, 7));
expect(executionFrame().src).toContain(
  '/frame.html?mode=run&session=11&run=7'
);
```

Add wrong-source/session/run, malformed shape/method/event ID, unsafe or negative
tokens, stale frame, cancellation, cleanup, relay parser, and monotonically
increasing per-execution event-ID cases.

- [ ] **Step 2: Run the runtime suite and verify it fails on `srcdoc`/single-token behavior**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-runtime.spec.ts
```

Expected: FAIL because the runner imports dependencies in its own realm, uses unsandboxed `srcdoc`, and exposes single-token prefix parsers.

- [ ] **Step 3: Generate `/frame.html` and the child bootstrap**

`frameHtmlSource()` returns a fixed document whose inline module bootstrap validates
query mode/tokens, installs the existing bounded console shim, and imports:

```ts
const entry = mode === 'warmup'
  ? '/warmup.ts'
  : `/execution.ts?session=${sessionToken}&run=${runToken}`;
void import(/* @vite-ignore */ entry).then(
  () => send(mode === 'warmup' ? 'ready' : 'complete'),
  (error) => {
    send(mode === 'warmup' ? 'prepareError' : 'error', normalize(error));
    if (mode === 'run') send('complete');
  }
);
```

`send()` builds the bounded discriminated record and calls only
`parent.postMessage(record, '*')`; the opaque child never reads properties from
`parent` or reaches for a shared bridge function.

In run mode, initialize `let nextEventId = 0` for that fresh execution frame and
attach one incrementing safe-integer ID to every relayed output, `clear`, and
top-level error. Warmup console calls are not user output and are not relayed;
warmup emits only tokened `ready` or `prepareError`. Completion carries no event
ID.

Move the existing `boundedText`, snapshot/error de-duplication, console `assert/clear/count/time/timeEnd`, and per-value limits unchanged into the child. Slice calls to 19 values plus `[Truncated]` before `postMessage`.

- [ ] **Step 4: Generate a privileged frame manager with no package imports**

The command listener validates `event.source === parent`, the discriminator,
allowed action, and safe non-negative integer tokens. The child listener validates
active frame, token domain, discriminator, method, event ID, and bounded payload
shape before relaying the record through the Sandpack console channel. Frame
creation is exactly:

```js
const frame = document.createElement('iframe');
frame.hidden = true;
frame.setAttribute('aria-hidden', 'true');
frame.setAttribute('sandbox', 'allow-scripts');
frame.src = mode === 'warmup'
  ? `/frame.html?mode=warmup&session=${sessionToken}`
  : `/frame.html?mode=run&session=${sessionToken}&run=${runToken}`;
document.body.append(frame);
```

`prepare` replaces any frame and clears readiness. Matching warmup `ready`
removes that frame and retains `preparedSession`; matching `prepareError` removes
the warmup frame without marking the session prepared. `run` requires a prepared
session. `cancel` removes only the matching execution and relays one `cancelled`.
An execution `error` is nonterminal and leaves the frame/listener alive for the
following `complete`; completion, matching cancellation, and replacement remove
the execution frame/listener exactly once.

- [ ] **Step 5: Consolidate relay and execution-file helpers**

Use one private Sandpack marker and one `runtimeRelayRecord()` parser. The new `setupForRun()` changes only `/execution.ts` and appends:

```ts
`${code}\n// session:${sessionToken}\n// run:${runToken}\n`;
```

For this task only, rename deployed helpers to `legacyRuntimeSource`, `legacyRuntimeCommand`, and `legacySetupForRun`, and point `playground.tsx` at those aliases. Task 3 must delete every legacy export/test after integrating the final API.

- [ ] **Step 6: Run focused tests, type checking, and build**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-runtime.spec.ts
npx tsc -p docs/tsconfig.spec.json --noEmit
npm --prefix docs run build
```

Expected: PASS; final runtime sources are directly tested while temporary legacy imports keep the page operational.

- [ ] **Step 7: Commit the protocol primitive**

```bash
git add docs/src/components/playground/playground-runtime.ts \
  docs/src/components/playground/playground.tsx \
  docs/test/playground-runtime.spec.ts
git commit -m "feat(docs): define isolated playground runtime"
```

---

### Task 3: Extract and integrate the sandbox controller

**Files:**
- Create: `docs/src/components/playground/playground-sandbox.tsx`
- Create: `docs/test/playground-sandbox.spec.tsx`
- Modify: `docs/src/components/playground/playground-runtime.ts`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/test/playground.spec.tsx`

**Interfaces:**
- Consumes: Task 1 dependency/local-source exports and Task 2 runtime protocol.
- Produces:

```ts
export type PlaygroundRunRequest = Readonly<{
  runToken: number;
  sandboxKey: string;
  code: string;
}>;
export type PlaygroundTheme = 'light' | 'dark';
export type PlaygroundSandboxStatus =
  | 'Preparing runtime'
  | 'Downloading packages'
  | 'Installing packages'
  | 'Starting Vite'
  | 'Ready'
  | 'Running'
  | 'Failed';
export type PlaygroundRunPhase = 'queued' | 'committing' | 'executing';
export type PlaygroundOutputUpdate =
  | { type: 'reset'; runToken: number }
  | { type: 'clear'; runToken: number }
  | { type: 'append'; runToken: number; method: RuntimeConsoleMethod;
      data: readonly PlaygroundConsoleValue[] }
  | { type: 'truncated'; runToken: number };
export type PlaygroundRunSettlement =
  | { runToken: number; outcome: 'completed'; failed: boolean }
  | { runToken: number; outcome: 'cancelled' }
  | { runToken: number; outcome: 'runtime-unavailable' }
  | { runToken: number; outcome: 'runtime-restarted' };

// `playground.tsx` adds editor/import states and maps settlement outcomes to
// `Failed — runtime unavailable` or `Failed — runtime restarted`.

export type PlaygroundSandboxProps = PropsWithChildren<{
  sandboxKey: string;
  dependencies: PlaygroundDependencies;
  initialCode: string;
  theme: PlaygroundTheme;
  runRequest: PlaygroundRunRequest | null;
  cancelRunToken: number | null;
  onReady(sandboxKey: string): void;
  onPhaseChange(runToken: number, phase: PlaygroundRunPhase): void;
  onOutput(update: PlaygroundOutputUpdate): void;
  onSettled(settlement: PlaygroundRunSettlement): void;
  onStatus(status: PlaygroundSandboxStatus): void;
}>;
```

- [ ] **Step 1: Create a failing focused Sandpack-controller harness**

Add provider/client mocks and a happy-path test:

```ts
it('prepares one session and runs only after its exact write acknowledgement', () => {
  renderSandbox({ runRequest: request(7) });
  emitSandpack({ type: 'done', compilatonError: false });
  expect(lastRuntimeCommand()).toMatchObject({
    action: 'prepare',
    sessionToken: expect.any(Number),
  });
  emitRuntimeReady(activeSessionToken());
  expect(updatedExecution()).toContain('// run:7');
  acknowledgeExecutionWrite();
  expect(lastRuntimeCommand()).toEqual({
    type: '__FAVY_PLAYGROUND_RUNTIME__',
    action: 'run',
    sessionToken: activeSessionToken(),
    runToken: 7,
  });
});
```

After the acknowledged `/execution.ts` update, emit another Sandpack `done` and
assert it does not send a second `prepare` or replace the prepared session.

Assert `/runner.ts` has no dependency import, `/frame.html` contains the inline
bootstrap, `/warmup.ts`, all local files, CORS Vite config, and registry-only
`customSetup.dependencies`.

- [ ] **Step 2: Run the new sandbox test and verify the component is missing**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-sandbox.spec.tsx
```

Expected: FAIL because `PlaygroundSandbox` does not exist.

- [ ] **Step 3: Create the provider and keyed controller seam**

`PlaygroundSandbox` creates fixed files per `sandboxKey`, renders a private keyed controller plus visible children, and filters registry dependencies:

```tsx
<SandpackProvider
  template="vite"
  files={files}
  customSetup={{ entry: '/runner.ts', dependencies: registryDependencies }}
  options={SANDBOX_OPTIONS}
  theme={theme}
>
  <SandboxController key={controllerGeneration} {...controllerProps} />
  {children}
</SandpackProvider>
```

Vite disables HMR, aliases exact `@favy/di`, and enables wildcard CORS. `/warmup.ts` imports every logical dependency key; only external `latest` entries enter registry setup.

- [ ] **Step 4: Implement happy-path orchestration**

On the first successful boot `done` for a controller generation, mark boot
handled and allocate/send `prepare(sessionToken)`. Ignore later `done` events
caused by `/execution.ts` updates; only the exact `fs/change` path/content
acknowledgement participates in commit. Only matching relayed `ready` marks the
session ready. `playground.tsx` allocates each request's run token from its
monotonic safe-integer counter at click time; the sandbox wrapper separately
allocates session tokens from its own monotonic safe-integer counter. Neither
owner reuses a token during the page lifetime. A request is eligible only when
its `sandboxKey` matches the mounted dependency session; it otherwise remains
with the parent for the replacement session. An eligible request waits queued;
readiness calls `setupForRun`, emits `reset`, stores exact `/execution.ts`
content, and calls `updateSandbox`. Only the exact path/content acknowledgement
sends `run` and enters executing. Matching output/error/complete updates the
parent and settles once.

Key the controller—not `SandpackProvider`—for outer runtime restart. Remounting `useSandpackClient` unregisters/recreates only its hidden iframe; visible Monaco children stay mounted.

- [ ] **Step 5: Move presentation and drafts back to `playground.tsx`**

Delete `SandboxContents`, `SandboxSession`, `useImperativeHandle`, and the editor
roundtrip through `useActiveCode`. Keep `TypeScriptEditor`, console
lines/formatter, picker, toolbar, and status in `playground.tsx`, with `editorRef`
held there. Seed `/index.ts` from `initialCode` when the dependency provider is
created; ordinary edits stay in the parent editor and only the captured Run
snapshot is committed to `/execution.ts`.

```ts
const handleOutput = (update: PlaygroundOutputUpdate): void => {
  if (update.type === 'reset' || update.type === 'clear') setConsoleLines([]);
  else if (update.type === 'truncated') {
    setConsoleLines((lines) => [...lines, '[Output truncated]']);
  } else {
    const line = update.data.map(formatConsoleValue).join(' ');
    if (line) setConsoleLines((lines) => [...lines, line]);
  }
};
```

Capture the editor immediately before dependency-key replacement and restore only that same draft after its editor child remounts.

- [ ] **Step 6: Remove every temporary legacy runtime export**

Switch production to Task 2 APIs. Delete `legacyRuntimeSource`, `legacyRuntimeCommand`, `legacySetupForRun`, `runSource`, `completionToken`, `runOutputRecord`, and `runErrorRecord` plus obsolete tests.

- [ ] **Step 7: Run focused/full tests, types, and build**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npm --prefix docs run build
```

Expected: PASS; normal completion reuses the outer iframe and all existing draft/example/console behavior remains.

- [ ] **Step 8: Commit the integrated extraction**

```bash
git add docs/src/components/playground/playground-sandbox.tsx \
  docs/src/components/playground/playground-runtime.ts \
  docs/src/components/playground/playground.tsx \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
git commit -m "refactor(docs): isolate playground sandbox controller"
```

---

### Task 4: Make run lifecycle, retries, and cancellation bounded

**Files:**
- Modify: `docs/src/components/playground/playground-sandbox.tsx`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/test/playground-sandbox.spec.tsx`
- Modify: `docs/test/playground.spec.tsx`

**Interfaces:**
- Produces the private state machine:

```ts
type RunLifecycle =
  | { phase: 'idle' }
  | { phase: 'queued'; request: PlaygroundRunRequest;
      infrastructureRetries: 0 | 1 }
  | { phase: 'committing'; request: PlaygroundRunRequest;
      infrastructureRetries: 0 | 1; sessionToken: number;
      expectedContent: string }
  | { phase: 'executing'; request: PlaygroundRunRequest;
      infrastructureRetries: 0 | 1; sessionToken: number; failed: boolean }
  | { phase: 'cancelling'; request: PlaygroundRunRequest;
      sessionToken: number };
```

- [ ] **Step 1: Add failing watchdog and cancellation tests**

```ts
it('keeps a cold request queued past 30 seconds and launches once when ready', () => {
  renderSandbox({ runRequest: request(7) });
  act(() => jest.advanceTimersByTime(31_000));
  expect(updatedExecutions()).toHaveLength(0);
  expect(onSettled).not.toHaveBeenCalled();
  emitRuntimeReady(activeSessionToken());
  expect(updatedExecutions()).toHaveLength(1);
});

it('retries one pre-execution infrastructure failure under a new session', () => {
  renderSandbox({ runRequest: request(7) });
  act(() => jest.advanceTimersByTime(120_000));
  expect(activeSessionToken()).not.toBe(firstSessionToken());
  emitRuntimeReady(activeSessionToken());
  acknowledgeExecutionWrite();
  expect(lastRuntimeCommand()).toMatchObject({ runToken: 7 });
});
```

Also test first/second preparation error, 120-second timeout, 10-second commit
timeout, stale old-session acknowledgement, 29,999/30,000 execution boundary,
every cancellation phase, missing acknowledgement at 1,000 ms,
completion/cancellation race, StrictMode cleanup, and no execution retry. Assert
Reset stays enabled and preserves a same-signature prepared session, while
navigation to a different dependency signature replaces that session after the
active request settles.

- [ ] **Step 2: Run focused lifecycle tests and verify failures**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
```

Expected: FAIL on missing phase-specific watchdogs, retry budget, and acknowledged cancellation.

- [ ] **Step 3: Implement explicit transitions and four timers**

Use one timer ref per boundary and clear it before each transition. Start preparation only while waiting for session readiness, commit only after `updateSandbox`, execution only after sending `run`, and cancellation only after cancelling active execution.

Keep `controllerGeneration` and the request/retry ledger in the stable
`PlaygroundSandbox` wrapper; keep each generation's client, session, listeners,
and timers in the keyed controller. Before unmounting a failed controller, its
restart callback transfers the exact request and retry count to the wrapper.

Preparation error/timeout and commit timeout call `restartBeforeExecution()`:
retry zero becomes one, increments `controllerGeneration`, allocates a new
session, and requeues the exact request; retry one settles
`runtime-unavailable`. Execution timeout settles `runtime-restarted`, increments
controller generation, and never requeues.

- [ ] **Step 4: Implement phase-specific parent transition handoff**

```ts
type PendingTransition =
  | { type: 'select'; id: PlaygroundExampleId }
  | { type: 'reset'; id: PlaygroundExampleId };
```

Apply immediately without a request. Otherwise store it and set
`cancelRunToken`. Sandbox locally settles queued/committing cancellation and
sends `runtimeCancelCommand` for executing. A matching acknowledgement settles
cancelled without remount; a missing acknowledgement remounts at 1,000 ms and
then settles that same cancellation exactly once. Settlement clears once and
then applies the pending transition even if completion raced cancellation.
Ignore old session/run messages.

Do not key the provider by reset generation: a same-dependency Reset keeps the
prepared background graph. Let the resulting dependency signature alone decide
whether example navigation preserves or replaces the provider session.

- [ ] **Step 5: Run focused and full verification**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: PASS with zero pending timers after cleanup; controller restart retains the editor node.

- [ ] **Step 6: Commit lifecycle hardening**

```bash
git add docs/src/components/playground/playground-sandbox.tsx \
  docs/src/components/playground/playground.tsx \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
git commit -m "fix(docs): bound playground run lifecycle"
```

---

### Task 5: Bound source and console resources

**Files:**
- Modify: `docs/src/components/playground/playground-runtime.ts`
- Modify: `docs/src/components/playground/playground-sandbox.tsx`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/test/playground-runtime.spec.ts`
- Modify: `docs/test/playground-sandbox.spec.tsx`
- Modify: `docs/test/playground.spec.tsx`

**Interfaces:**

```ts
export const MAX_PLAYGROUND_SOURCE_BYTES = 65_536;
export const isPlaygroundSourceWithinLimit: (source: string) => boolean;
type OutputBudget = {
  acceptedEvents: number;
  acceptedBytes: number;
  closed: boolean;
  seenEventIds: Set<number>;
};
```

- [ ] **Step 1: Add failing UTF-8 source-boundary tests**

```ts
expect(isPlaygroundSourceWithinLimit('a'.repeat(65_536))).toBe(true);
expect(isPlaygroundSourceWithinLimit('a'.repeat(65_536) + '🙂')).toBe(false);

it('keeps oversized source editable without parsing or running it', () => {
  const oversized = 'a'.repeat(65_537);
  fireEvent.change(editor(), { target: { value: oversized } });
  expect((editor() as HTMLTextAreaElement).value).toBe(oversized);
  expect(screen.getByRole('status').textContent).toContain(
    'Source is too large (64 KiB maximum)'
  );
  expect(
    (screen.getByRole('button', { name: 'Run code' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  act(() => jest.advanceTimersByTime(1_000));
  expect(resolveSpy).not.toHaveBeenCalled();
  expect(updateEvents()).toHaveLength(0);
});
```

Store an oversized draft, navigate away, and return. Assert the editor restores
the full draft while the new Sandpack provider receives a fixed small placeholder
for `/index.ts`; the oversized string must not appear in provider files or
`updateSandbox` calls.

- [ ] **Step 2: Add failing output-accounting tests**

Cover 199 accepted events plus one notice, early byte overflow, 20 arguments,
duplicates/invalid IDs, `clear` preserving cumulative counters, errors sharing
budget, completion/cancellation consuming no budget, and no output after closure.
Assert at most 200 visible updates and exactly one `truncated` update.

- [ ] **Step 3: Run focused tests and verify limits are absent**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
```

Expected: FAIL because source always reaches parsing and console state/IDs can grow.

- [ ] **Step 4: Implement an allocation-light UTF-8 gate**

Walk code points, add 1/2/3/4 bytes, advance over surrogate pairs, and return false immediately above 65,536. Check before scheduling/applying dependency scans, deriving typing versions, changing Sandpack dependencies, or constructing a Run request.

When a provider must be created for a restored oversized draft, pass the fixed
small source `// Source is too large to load into the sandbox.` as `initialCode`.
Keep the real draft only in parent/editor state; correcting it below the limit
may resume normal dependency reconciliation and provider updates.

Visible blocking precedence is: oversized source; unsupported import; incomplete/checking; sandbox runtime status. Correcting source below the limit resumes the one-second scan.

- [ ] **Step 5: Implement cumulative output accounting before presentation state**

Reset per run. Validate first and add an ID only after acceptance. Measure UTF-8
bytes of `JSON.stringify(data)` (`[error]` for errors and `[]` for `clear`). Accept
at most 199 unique output/error/clear events and 65,536 user bytes; first overflow
emits one final `truncated`, excluded from user bytes, then closes. `clear` does
not reset counters/IDs. Bound React de-duplication to the same accepted count.
Clear the budget and its accepted-ID set on settlement and unmount.

- [ ] **Step 6: Run focused/full tests, types, and build**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npm --prefix docs run build
```

Expected: PASS; oversized code never reaches parser/typings/Sandpack and console presentation stays bounded.

- [ ] **Step 7: Commit resource bounds**

```bash
git add docs/src/components/playground/playground-runtime.ts \
  docs/src/components/playground/playground-sandbox.tsx \
  docs/src/components/playground/playground.tsx \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx
git commit -m "fix(docs): bound playground resources"
```

---

### Task 6: Isolate automatic typings generations

**Files:**
- Create: `docs/src/components/typescript-editor-typings.ts`
- Create: `docs/test/typescript-editor-typings.spec.ts`
- Modify: `docs/src/components/typescript-editor.tsx`
- Modify: `docs/test/typescript-editor.spec.tsx`

**Interfaces:**

```ts
export type AutoTypingsGeneration = Readonly<{
  monaco: Monaco;
  sourceCache: SourceCache;
  sourceResolver: SourceResolver;
  invalidate(): void;
}>;
export function createAutoTypingsGeneration(options: Readonly<{
  monaco: Monaco;
  sourceCache: SourceCache;
  fetchSource?: typeof globalThis.fetch;
}>): AutoTypingsGeneration;
```

- [ ] **Step 1: Add failing generation-race tests**

Cover deferred fetch before response/text for both SourceResolver entry points,
deferred cache read, late store, stale `createModel`, owned/unowned model
disposal, and recreation of one URI:

```ts
const generation = createAutoTypingsGeneration({
  monaco,
  sourceCache,
  fetchSource,
});
const pending = generation.sourceResolver.resolveSourceFile(
  'pkg',
  '1',
  'index.d.ts'
);
generation.invalidate();
expect(fetchSignal.aborted).toBe(true);
resolveFetch(response('export type Old = true'));
await expect(pending).resolves.toBeUndefined();
expect(monaco.editor.createModel).not.toHaveBeenCalled();
```

Repeat the same abort-before-response and invalidate-after-`response.text()`
barriers with:

```ts
generation.sourceResolver.resolvePackageJson('pkg', '1', 'feature');
generation.sourceResolver.resolveSourceFile('pkg', '1', 'index.d.ts');
```

Assert invalidation disposes only facade-created models and a second generation recreates the same versionless URI with new content.

- [ ] **Step 2: Run the helper test and verify the module is missing**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/typescript-editor-typings.spec.ts
```

Expected: FAIL because the generation helper does not exist.

- [ ] **Step 3: Implement resolver/cache/model write guards**

Use one `AbortController` and `active` boolean. Implement and guard both
`resolvePackageJson(packageName, version?, subPath?)` and
`resolveSourceFile(packageName, version, path)`: each checks before fetch, after
fetch, and after `response.text`; abort/invalidation returns `undefined`, active
failures propagate. Cache reads check both sides of `await`; stores/clears no-op
when inactive. Never clear the underlying shared `LocalStorageCache` on
invalidation.

Wrap `monaco.editor` in a generation facade. `createModel` delegates only while active, records the model, and returns an intentionally typed no-model without delegating when stale because 0.4.6 ignores the return. `invalidate()` is idempotent, aborts, and disposes only owned models.

- [ ] **Step 4: Add failing component acquisition tests**

Test: mount creates once; value edits and a fresh equivalent version object
create zero more generations; a changed sorted signature creates one; the
returned `AutoTypings` instance is immediately disposed while the editor remains
usable. Hold resolver/cache/model promises across a version change and across
component unmount, then assert both paths abort, perform no late cache/model
writes, and dispose only the outgoing generation's owned models.

- [ ] **Step 5: Replace mount-only acquisition with signature-driven generations**

Canonicalize sorted `typingVersions`. On editor mount or distinct signature, invalidate prior generation, create guarded adapters/facade, and call:

```ts
const autoTypes = await AutoTypings.create(editor, {
  monaco: generation.monaco,
  versions: { ...versions },
  onlySpecifiedPackages: true,
  preloadPackages: true,
  shareCache: false,
  sourceCache: generation.sourceCache,
  sourceResolver: generation.sourceResolver,
  debounceDuration: 0,
  fileRootPath: 'file:///',
  dontAdaptEditorOptions: true,
  dontRefreshModelValueAfterResolvement: true,
  onError: () => {},
});
autoTypes.dispose();
```

Only the validated one-second app scan changes versions. Unmount invalidates. Import/create failure never blocks editing or Run.

- [ ] **Step 6: Run focused/full editor tests and types**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/typescript-editor-typings.spec.ts \
  docs/test/typescript-editor.spec.tsx
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: PASS with no stale cache/model writes or equivalent-input reacquisition.

- [ ] **Step 7: Commit typings isolation**

```bash
git add docs/src/components/typescript-editor-typings.ts \
  docs/src/components/typescript-editor.tsx \
  docs/test/typescript-editor-typings.spec.ts \
  docs/test/typescript-editor.spec.tsx
git commit -m "fix(docs): isolate automatic typings generations"
```

---

### Task 7: Preserve focus intent across editor replacement

**Files:**
- Modify: `docs/src/components/typescript-editor.tsx`
- Modify: `docs/test/typescript-editor.spec.tsx`
- Modify: `docs/test/playground.spec.tsx`

**Interfaces:**
- Extends `TypeScriptEditorSnapshot`:

```ts
focusGuard?: Readonly<{
  document: Document;
  focusedElement: Element;
  generation: number;
}>;
```

- [ ] **Step 1: Add failing selection/focus race tests**

Cover focused outgoing editor without intervening focus, external button focused before replacement, unfocused capture, controller-only restart, dependency-session replacement, reset, and example navigation.

```ts
const snapshot = ref.current?.capture();
externalButton.focus();
rerender(<TypeScriptEditor key="replacement" {...props} />);
ref.current?.restore(snapshot!);
expect(document.activeElement).toBe(externalButton);
expect(replacementEditor().selectionStart).toBe(expectedSelection.start);
expect(replacementEditor().selectionEnd).toBe(expectedSelection.end);
```

- [ ] **Step 2: Run focused tests and verify focus is stolen**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/typescript-editor.spec.tsx \
  docs/test/playground.spec.tsx
```

Expected: FAIL because `hadFocus` currently focuses unconditionally.

- [ ] **Step 3: Add one focus-generation tracker per document**

Use `WeakMap<Document, FocusTracker>` with one `focusin` generation counter. Capture generation and active element only when Monaco reports text focus. Always restore clamped selection; focus only when:

```ts
snapshot.hadFocus &&
snapshot.focusGuard?.generation === tracker.generation &&
!snapshot.focusGuard.focusedElement.isConnected &&
(document.activeElement === document.body || document.activeElement === null)
```

Check immediately before `editor.focus()` so any intervening `focusin` cancels restoration.

- [ ] **Step 4: Lock the final controller/editor boundary**

Assert execution-time controller remount keeps the exact editor DOM node, focus, and selection. Only dependency-provider replacement uses snapshot restoration. Reset/example navigation retain normal focus.

- [ ] **Step 5: Run focused/full tests and commit**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/typescript-editor.spec.tsx \
  docs/test/playground.spec.tsx
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
git add docs/src/components/typescript-editor.tsx \
  docs/test/typescript-editor.spec.tsx \
  docs/test/playground.spec.tsx
git commit -m "fix(docs): preserve playground editor focus intent"
```

---

### Task 8: Correct fallback, busy, and theme semantics

**Files:**
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/src/components/playground/playground.css`
- Modify: `docs/src/pages/playground.astro`
- Modify: `docs/test/playground.spec.tsx`
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Produces stable theme button name `Dark theme`, with only `aria-pressed` tracking mode.
- Produces one exposed read-only fallback textbox and an `aria-hidden` Sandpack visual subtree.
- Separates `isBusy` from `runDisabled`.

- [ ] **Step 1: Add failing fallback and busy-state tests**

Make the Sandpack mock expose internal `role="tabpanel"`. In fallback mode assert it has an `aria-hidden` ancestor and exactly one exposed textbox has name `TypeScript playground editor`, full source, `readOnly`, and `tabIndex=0`. Assert visual/accessibility controls share a parent but neither contains the other.

After Monaco mounts, assert there is still exactly one exposed editor textbox.
Also cover committing, executing, settled, cancelled, background preparation,
and invalid-source-during-active-run states in addition to the compact table.

Add a state table:

```ts
expectState('Ready', { disabled: false, busy: 'false', spinner: false });
expectState('queued', { disabled: true, busy: 'true', spinner: true });
expectState('unsupported', { disabled: true, busy: 'false', spinner: false });
expectState('oversized', { disabled: true, busy: 'false', spinner: false });
```

- [ ] **Step 2: Run component tests and verify semantics fail**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground.spec.tsx
```

Expected: FAIL on unnamed tabpanel exposure and `aria-busy={runDisabled}`.

- [ ] **Step 3: Implement sibling visual/accessibility controls**

```tsx
<div className="playground__editor-fallback">
  <div className="playground__editor-fallback-visual" aria-hidden="true">
    <SandpackCodeEditor
      initMode="immediate"
      readOnly
      showLineNumbers
      showRunButton={false}
      showTabs={false}
    />
  </div>
  <textarea
    className="playground__editor-fallback-control"
    aria-label="TypeScript playground editor"
    aria-readonly="true"
    readOnly
    tabIndex={0}
    value={activeCode}
  />
</div>
```

Keep the textarea compact over the highlighted visual until focused; on focus expose a readable plain-code surface and visible outline, avoiding an invisible keyboard stop.

- [ ] **Step 4: Derive busy and disabled independently**

```ts
const isBusy =
  runRequest !== null ||
  runtimeStatus === 'Preparing dependencies' ||
  runtimeStatus === 'Preparing runtime' ||
  runtimeStatus === 'Downloading packages' ||
  runtimeStatus === 'Installing packages' ||
  runtimeStatus === 'Starting Vite';
const runDisabled = isBusy || blockingSourceIssue !== undefined;
```

Set toolbar `aria-busy={isBusy}` and render the spinner only for busy. Invalid/oversized source alone is not busy; an invalid edit during an active run remains busy.

- [ ] **Step 5: Stabilize theme toggle semantics**

Use static `aria-label="Dark theme"` and initial `aria-pressed="true"`; `syncThemeButton()` changes only pressed state. Update smoke expectations for light false, dark true, light false, and persisted dark true, always with the same name.

- [ ] **Step 6: Run component/type/build verification and commit**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/playground.spec.tsx
npx tsc -p docs/tsconfig.spec.json --noEmit
npm --prefix docs run build
git add docs/src/components/playground/playground.tsx \
  docs/src/components/playground/playground.css \
  docs/src/pages/playground.astro \
  docs/test/playground.spec.tsx \
  docs/scripts/docs-pages-smoke.mjs
git commit -m "fix(docs): clarify playground accessibility state"
```

---

### Task 9: Make browser smoke self-hosting and prove isolation/performance

**Files:**
- Create: `docs/scripts/run-docs-smoke.mjs`
- Modify: `docs/scripts/docs-pages-smoke.mjs`
- Modify: `docs/package.json`
- Modify: `docs/project.json`
- Modify: `nx.json`
- Create: `docs/test/repository-integration.spec.ts`

**Interfaces:**
- `npm --prefix docs test` runs Jest serially.
- `npm --prefix docs run smoke` owns an Astro preview at `127.0.0.1:4399` unless `DOCS_URL` points at an already-managed server.
- `docs:smoke` is an explicit non-cacheable Nx target that depends on `docs:build`.
- The Nx Astro target declares its real output directory as `{projectRoot}/dist`.

- [ ] **Step 1: Add failing repository contract tests**

Read `docs/package.json`, `docs/project.json`, and `nx.json` as JSON. Assert:

```ts
expect(packageJson.scripts.test).toBe('jest --runInBand');
expect(packageJson.scripts.smoke).toBe('node scripts/run-docs-smoke.mjs');
expect(project.targets.smoke).toEqual(
  expect.objectContaining({
    executor: 'nx:run-commands',
    cache: false,
    dependsOn: ['build'],
    options: { command: 'npm --prefix docs run smoke' },
  })
);
expect(project.targets.test).toBeUndefined();
expect(nxJson.targetDefaults['@nxtensions/astro:build'].outputs).toContain(
  '{projectRoot}/dist'
);
```

- [ ] **Step 2: Run the focused test and verify the missing contracts**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/repository-integration.spec.ts
```

Expected: FAIL because the managed wrapper, explicit smoke target, and corrected output path do not exist.

- [ ] **Step 3: Implement the managed smoke wrapper and Nx/package contracts**

When `DOCS_URL` is unset, `run-docs-smoke.mjs` must:

1. Resolve `../node_modules/astro/astro.js` from `import.meta.url` and spawn
   `process.execPath` with that CLI plus
   `preview --host 127.0.0.1 --port ${DOCS_SMOKE_PORT ?? 4399}`, with `cwd` set
   to `docs`. This child is the Astro preview itself, not an npm wrapper.
2. Poll the preview URL every 100 ms for at most 30 seconds, racing readiness against early child exit.
3. Set `process.env.DOCS_URL` and dynamically import `docs-pages-smoke.mjs` only after readiness.
4. In `finally`, send `SIGTERM` to that exact Astro child, wait a bounded grace
   period, and send `SIGKILL` only to the same Astro child if it has not exited.

When `DOCS_URL` is set, invoke the smoke directly and do not start, stop, or mutate any server. Add the exact scripts and Nx target covered by Step 1. Change the Astro build output from `{workspaceRoot}/dist/{projectRoot}` to `{projectRoot}/dist`.

- [ ] **Step 4: Add opaque-frame, local-source, and external-import browser assertions**

Launch Playwright with `chromium.launch()` and collect cold-page requests before navigation. Assert that the first playground load:

- never requests registry or jsDelivr URLs containing decoded `@favy/di`;
- does request pathname `/favy-di/index.ts` from the active Sandpack Vite origin;
- runs external packages in a nested iframe whose sandbox token list is exactly `allow-scripts`;
- reports `self.origin === 'null'` and throws when reading `parent.document`;
- sends `Origin: null` on opaque-frame module requests;
- receives `Access-Control-Allow-Origin: *` for `/frame.html` and every imported local module.

Exercise the external graph with:

```ts
import camelCase from 'lodash/camelCase';

let parentBlocked = false;
try {
  void parent.document;
} catch {
  parentBlocked = true;
}
console.log(camelCase('opaque module graph'), parentBlocked, self.origin);
await new Promise((resolve) => setTimeout(resolve, 750));
```

Inspect the nested execution frame while the final promise is pending, then assert output `opaqueModuleGraph`, `true`, and `null`.

- [ ] **Step 5: Preserve the complete user-facing smoke matrix**

Keep assertions for all six examples, HKT hover, light/dark persistence, keyboard
activation, reset/drafts, responsive layout, and accessibility. Preserve the
script-blocked first-paint check and focus its one exposed read-only fallback
textbox. Add lifecycle checks that the outer Sandpack runtime iframe stays
identical across successful runs, the document does not reload, no package or
local-module graph request repeats during the warm pair, and two already-warm
runs each complete in less than 1,000 ms. Print measured durations for local
comparison with the 30–40 ms baseline, but do not enforce that
workstation-specific number in CI.

- [ ] **Step 6: Verify the wrapper, browser contract, and build**

```bash
node --check docs/scripts/run-docs-smoke.mjs
node --check docs/scripts/docs-pages-smoke.mjs
npm --prefix docs run build
PLAYGROUND_ONLY=1 npm --prefix docs run smoke
```

Expected: build succeeds; smoke starts and tears down its own preview and passes the full playground matrix.

- [ ] **Step 7: Verify Nx execution and commit**

```bash
npx nx show project docs --json
npx nx run docs:smoke --skip-nx-cache
git add docs/scripts/run-docs-smoke.mjs \
  docs/scripts/docs-pages-smoke.mjs \
  docs/package.json docs/project.json nx.json \
  docs/test/repository-integration.spec.ts
git commit -m "test(docs): self-host isolated playground smoke"
```

---

### Task 10: Enforce clean docs CI and finish release documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Delete: `workflows/ci.yml`
- Modify: `docs/test/repository-integration.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-04-interactive-playground-design.md`

- [ ] **Step 1: Add failing workflow and documentation assertions**

Extend the repository integration test to assert that:

- `.github/workflows/ci.yml` exists and `workflows/ci.yml` does not;
- CI pins Node 20, runs `npm ci` at both repository roots, installs bundled Chromium, and runs docs build plus smoke;
- the root README links to `/playground/`;
- the older playground design explicitly links to the prewarm, type-hover, standalone-page, and merge-hardening specs as superseding decisions.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/repository-integration.spec.ts
```

Expected: FAIL because the workflow is undiscoverable and the release-facing documentation is incomplete.

- [ ] **Step 3: Move and harden the clean-checkout workflow**

Create `.github/workflows/ci.yml`, remove the misplaced workflow, preserve existing triggers, and use this job order:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm
    cache-dependency-path: |
      package-lock.json
      docs/package-lock.json
- run: npm ci
- run: npm ci
  working-directory: docs
- uses: nrwl/nx-set-shas@v4
- run: npx nx affected -t lint test build
- run: npx playwright install --with-deps chromium
  working-directory: docs
- run: npx nx build docs --skip-nx-cache
- run: npx nx run docs:smoke --skip-nx-cache
```

- [ ] **Step 4: Finish README and historical-spec routing**

Add a prominent `[Playground](https://di.favy.dev/playground/)` link to the root
README. At the top of `2026-08-04-interactive-playground-design.md`, add a
concise superseded-decisions note linking to
`2026-08-04-playground-prewarm-design.md`,
`2026-08-05-playground-type-hover-design.md`,
`2026-08-05-standalone-playground-design.md`, and
`2026-08-05-playground-merge-hardening-design.md`. Preserve the historical
document instead of rewriting its original decisions.

- [ ] **Step 5: Reproduce clean CI locally**

```bash
npm ci
npm ci --prefix docs
npm --prefix docs exec -- playwright install chromium
npx jest --config docs/jest.config.ts --runInBand \
  docs/test/repository-integration.spec.ts
npx nx affected -t lint test build --skip-nx-cache
npx nx build docs --skip-nx-cache
PLAYGROUND_ONLY=1 npm --prefix docs run smoke
git diff --check
git status --short
```

Expected: every command passes and status contains only the intended workflow/documentation changes plus untracked `.superpowers/`.

- [ ] **Step 6: Commit the CI/documentation boundary**

```bash
git add .github/workflows/ci.yml workflows/ci.yml \
  docs/test/repository-integration.spec.ts README.md \
  docs/superpowers/specs/2026-08-04-interactive-playground-design.md
git commit -m "ci: verify playground docs from clean checkout"
```

- [ ] **Step 7: Run final branch verification**

```bash
npx nx test docs --skip-nx-cache --runInBand
npx nx run docs:check --skip-nx-cache
npx tsc -p docs/tsconfig.spec.json --noEmit
npm --prefix docs run build
PLAYGROUND_ONLY=1 npm --prefix docs run smoke
npx prettier --check \
  docs/src/components/playground/favy-di-sources.ts \
  docs/src/components/playground/playground-dependencies.ts \
  docs/src/components/playground/playground.css \
  docs/src/components/playground/playground-runtime.ts \
  docs/src/components/playground/playground-sandbox.tsx \
  docs/src/components/playground/playground.tsx \
  docs/src/components/typescript-editor-typings.ts \
  docs/src/components/typescript-editor.tsx \
  docs/test/playground-dependencies.spec.ts \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground-sandbox.spec.tsx \
  docs/test/playground.spec.tsx \
  docs/test/typescript-editor-typings.spec.ts \
  docs/test/typescript-editor.spec.tsx \
  docs/test/repository-integration.spec.ts \
  docs/scripts/run-docs-smoke.mjs \
  docs/scripts/docs-pages-smoke.mjs
git diff --check 812d898..HEAD
git status --short --branch
```

Expected: tests, typecheck, build, browser smoke, and diff check pass; the branch is clean apart from untracked `.superpowers/`.
