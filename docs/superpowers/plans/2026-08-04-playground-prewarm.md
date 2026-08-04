# Playground Runtime Prewarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one prewarmed Sandpack Vite client alive so first-load highlighting works, preparation is visible, early runs queue safely, and warm runs finish below 200 ms without repeated npm downloads.

**Architecture:** A pure runtime helper owns warmup/run source generation, tokenized execution files, completion markers, progress labels, and immutable `updateSandbox()` setups. The React component keeps one provider keyed only by dependency signature and one explicit hidden client iframe. Example switches update the editor without destroying that runtime.

**Tech Stack:** Astro 4, React 18, TypeScript 5.7, `@codesandbox/sandpack-react@2.20.0`, `@codesandbox/sandpack-client`, Jest 29, Testing Library, Playwright.

## Global Constraints

- Keep Vite; `@favy/di@3.0.0` does not compile in Sandpack's `vanilla-ts` runtime.
- Never execute editable code before `Run`.
- Preserve import detection, one-second debounce, six examples, drafts, reset, shortcuts, console, focus restoration, and responsive/accessibility behavior.
- Remount Sandpack only when `dependencySignature()` changes.
- Queue exactly one early Run snapshot for the matching dependency generation.
- Hide private completion messages.
- Change private executable content on every run; SandpackNode can otherwise reuse stale module-cache contents.
- Local warm-run target: below 200 ms and zero repeated npm registry requests.
- Do not modify `editor.tsx`, `sandbox.astro`, library files under `di/`, or untracked `.superpowers/`.
- Never add a Codex/Anthropic co-author trailer.

## File map

- `docs/src/components/playground/playground-runtime.ts`: pure runtime protocol.
- `docs/test/playground-runtime.spec.ts`: protocol unit tests.
- `docs/src/components/playground/playground.tsx`: persistent runtime and UI state.
- `docs/test/playground.spec.tsx`: mocked lifecycle regressions.
- `docs/src/components/playground/playground.css`: spinner and first-paint palette.
- `docs/scripts/docs-pages-smoke.mjs`: browser/performance contract.

### Task 1: Add the pure runtime protocol

**Files:**
- Create: `docs/src/components/playground/playground-runtime.ts`
- Create: `docs/test/playground-runtime.spec.ts`

**Interfaces:**
- Produces `RUN_COMPLETE_PREFIX`, `warmupSource()`, `runSource()`, `setupForRun()`, `completionToken()`, and `preparationLabel()`.

- [ ] **Step 1: Write failing tests**

```ts
const setup: SandboxSetup = {
  entry: '/runner.ts',
  template: 'node',
  dependencies: { '@favy/di': '3.0.0' },
  files: {
    '/index.ts': { code: 'console.log("old")', active: true },
    '/execution.ts': { code: 'export {};', hidden: true },
    '/runner.ts': { code: 'export {};', hidden: true },
  },
};

it('warms dependencies without importing editable code', () => {
  const source = warmupSource(['@favy/di', 'lodash']);
  expect(source).toContain("import '@favy/di';");
  expect(source).toContain("import 'lodash';");
  expect(source).not.toContain('/index.ts');
});

it('tokenizes execution and does not mutate the previous setup', () => {
  const first = setupForRun(setup, 'console.log("new")', 7);
  const second = setupForRun(first, 'console.log("new")', 8);
  expect(first.files['/execution.ts'].code).toContain('// run:7');
  expect(second.files['/execution.ts'].code).toContain('// run:8');
  expect(first.files['/runner.ts'].code).toContain('/execution.ts?run=7');
  expect(setup.files['/index.ts'].code).toBe('console.log("old")');
});

it('recognizes only private debug completion records', () => {
  expect(completionToken({
    method: 'debug',
    data: [RUN_COMPLETE_PREFIX + '12'],
  })).toBe(12);
  expect(completionToken({
    method: 'log',
    data: [RUN_COMPLETE_PREFIX + '12'],
  })).toBeUndefined();
});

it.each([
  [{ type: 'dependencies', data: { state: 'downloading_manifest' } }, 'Downloading packages'],
  [{ type: 'dependencies', data: { state: 'starting' } }, 'Installing packages'],
  [{ type: 'shell/progress', data: { state: 'starting_command' } }, 'Starting Vite'],
])('maps preparation progress', (message, label) => {
  expect(preparationLabel(message as SandpackMessage)).toBe(label);
});
```

- [ ] **Step 2: Verify red**

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-runtime.spec.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the helper**

Use `SandboxSetup` and normalized `SandpackBundlerFile` types. Generate static
dependency imports in `warmupSource()`. Generate a dynamic import of
`/execution.ts?run=<token>` followed by one debug completion record in
`runSource()`. `setupForRun()` must clone the setup and write:

```ts
{
  '/index.ts': { ...oldIndex, code },
  '/execution.ts': {
    ...oldExecution,
    code: code + '\n// run:' + token + '\n',
  },
  '/runner.ts': { ...oldRunner, code: runSource(token) },
}
```

`completionToken()` accepts only one debug string with the exact prefix and a
safe integer suffix. `preparationLabel()` maps `dependencies` and
`shell/progress` states, using `in` checks where Nodebox/runtime declarations
differ.

- [ ] **Step 4: Verify green**

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-runtime.spec.ts
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: both PASS.

### Task 2: Keep one client and queue early runs

**Files:**
- Modify: `docs/test/playground.spec.tsx`
- Modify: `docs/src/components/playground/playground.tsx`

**Interfaces:**
- Consumes Task 1 helpers and `useSandpackClient()`.
- Produces one hidden client, dependency-only provider identity, and source-bearing run requests.

- [ ] **Step 1: Replace the destructive-run mock**

Mock `useSandpackClient()` with `iframe`, nullable `getClient()`, scoped
`listen()`, and a synchronous `updateSandbox(nextSetup)` that stores the next
setup and records an `update:` event. Add preparation, progress, error, and
console-debug message variants. Remove mocked `SandpackConsole standalone` so
the mock also has exactly one client.

- [ ] **Step 2: Add failing lifecycle tests**

```ts
it('keeps one provider across same-dependency switch and reset', () => {
  render(<Playground />);
  const mounts = mountEvents();
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(playgroundExampleById.composition.source);
  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));
  expect(editor().value).toBe(playgroundExampleById.basic.source);
  expect(mountEvents()).toEqual(mounts);
  expect(mockMaximumMountedProviders).toBe(1);
});

it('queues once during preparation and launches when ready', () => {
  render(<Playground />);
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  expect(screen.getByRole('status').textContent).toBe('Preparing runtime');
  expect(updateEvents()).toEqual([]);
  mockClientReady = true;
  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect(updateEvents()).toHaveLength(1);
  expect(updateEvents()[0]).toContain('/execution.ts?run=1');
});

it('ignores stale markers and hides the matching marker', () => {
  renderReadyPlayground();
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:999');
  expect(screen.getByRole('status').textContent).toBe('Running');
  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(screen.getByRole('log').textContent)
    .not.toContain('__FAVY_PLAYGROUND_DONE__');
});
```

Retain invalid-import, debounce, changed-dependency remount, focus, StrictMode,
timeout/error, and Ctrl/Cmd+Enter tests. Replace `run:` expectations with
`update:` expectations.

- [ ] **Step 3: Verify red**

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground.spec.tsx
```

Expected: FAIL because production still calls `runSandpack()` and remounts on
switch/reset.

- [ ] **Step 4: Implement the persistent lifecycle**

Use these state contracts:

```ts
type RunRequest = Readonly<{
  token: number;
  sandboxKey: string;
  code: string;
}>;

const SANDBOX_OPTIONS = Object.freeze({
  activeFile: '/index.ts',
  autorun: true,
  autoReload: false,
});

const keyFor = (dependencies: PlaygroundDependencies): string =>
  dependencySignature(dependencies);
```

Provider files are active `/index.ts` and hidden `/execution.ts`,
`/runner.ts`, and `/index.html`. HTML and `customSetup.entry` point at the
runner. The initial runner uses `warmupSource(Object.keys(dependencies))`.

Replace `SandpackConsole standalone` and `runSandpack()` with one
`useSandpackClient()` and one hidden iframe:

```tsx
<iframe
  ref={iframe}
  className="playground__runtime-client"
  title="Playground runtime"
  aria-hidden="true"
/>
```

One scoped listener handles initial readiness, progress, normal console output,
private completion markers, and runtime errors. Launch with:

```ts
const client = getClient();
if (!client) return finish('Failed');
setConsoleLines([]);
onStatus('Running');
client.updateSandbox(
  setupForRun(client.sandboxSetup, runRequest.code, runRequest.token)
);
```

A request stays queued until the matching runtime is ready. Dependency changes
still remount. For same-dependency switch/reset, call
`useActiveCode().updateCode(nextCode, false)`, suppress its programmatic
change callback, and clear visible output without remounting.

- [ ] **Step 5: Verify lifecycle and full unit suite**

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern='playground(-runtime)?\.spec\.tsx?$'
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: PASS and at most one provider/client.

### Task 3: Add first-paint colours and visible busy feedback

**Files:**
- Modify: `docs/test/playground.spec.tsx`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/src/components/playground/playground.css`

- [ ] **Step 1: Add failing UI tests**

```ts
it('hydrates from light and then follows document dark theme', () => {
  document.documentElement.dataset.theme = 'dark';
  render(<Playground />);
  expect(mockProviderThemes[0]).toBe('light');
  act(() => jest.runOnlyPendingTimers());
  expect(mockProviderThemes.at(-1)).toBe('dark');
});

it('shows Vite progress and a busy button label', () => {
  render(<Playground />);
  emitSandpackMessage({
    type: 'shell/progress',
    data: { state: 'starting_command' },
  });
  expect(screen.getByRole('status').textContent).toBe('Starting Vite');
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  expect(screen.getByRole('button', { name: 'Run code' }).textContent)
    .toContain('Preparing');
  expect(document.querySelector('.playground__spinner')).toBeTruthy();
});
```

- [ ] **Step 2: Verify red**

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground.spec.tsx
```

- [ ] **Step 3: Implement theme, labels, and styles**

Initialize theme as literal `light` and status as `Loading editor`. After
hydration, sync the document theme and observe changes. Editor readiness shows
`Preparing runtime` until the runtime is ready.

Keep accessible name `Run code`. While queued/running, show an animated
`playground__spinner` and `Preparing…`/`Running…`. Remove animation but retain
the shape under reduced motion.

Add SSR-scoped fallback token colours:

```css
astro-island[ssr] .playground .sp-syntax-plain,
astro-island[ssr] .playground .sp-syntax-punctuation { color: #d7dae0; }
astro-island[ssr] .playground .sp-syntax-keyword { color: #c792ea; }
astro-island[ssr] .playground .sp-syntax-definition,
astro-island[ssr] .playground .sp-syntax-property { color: #82aaff; }
astro-island[ssr] .playground .sp-syntax-string { color: #c3e88d; }
astro-island[ssr] .playground .sp-syntax-comment { color: #7f8799; }
```

- [ ] **Step 4: Verify UI/type/Astro checks**

```bash
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npx nx run docs:check --skip-nx-cache
git diff --check
```

Expected: all PASS.

### Task 4: Add real-browser and performance gates

**Files:**
- Modify: `docs/scripts/docs-pages-smoke.mjs`

- [ ] **Step 1: Test no-JavaScript first paint**

Open a JS-disabled dark context at `origin + '/playground/'` and compare
`getComputedStyle()` colours for `.sp-syntax-keyword` and
`.sp-syntax-plain`; assert they differ, then close that context.

- [ ] **Step 2: Test persistent warm runs**

After initial `Ready`, capture
`iframe.playground__runtime-client`'s element handle and start collecting
requests containing `registry.npmjs.org`. Click Run twice, waiting for `Ready`
after each; record `performance.now()` durations. Assert:

```js
assert.equal(await runtime.elementHandle(), initialRuntime);
assert.deepEqual(registryRequests, []);
assert.ok(warmDurations.every((duration) => duration < 1_000));
console.log(
  'Warm playground runs: ' +
    warmDurations.map(Math.round).join('ms, ') +
    'ms'
);
```

Retain the current proof that `Hello, Ada!` is absent before Run. The automated
limit is one second for CI variance; local verification must meet 200 ms.

- [ ] **Step 3: Run focused browser verification**

```bash
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4323 \
  node docs/scripts/docs-pages-smoke.mjs
```

Expected: focused contract PASS, same iframe, zero post-ready registry
requests, and local warm durations below 200 ms.

- [ ] **Step 4: Run the complete matrix**

```bash
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4323 \
  node docs/scripts/docs-pages-smoke.mjs
git diff --check
git status --short
```

Expected: all PASS and only intended files plus `.superpowers/`.

- [ ] **Step 5: Review and commit**

Confirm no `runSandpack()` call, no example/reset provider key, no visible
private marker, and no edit outside the file map. Commit without
`.superpowers/`:

```bash
git add docs/src/components/playground/playground-runtime.ts \
  docs/src/components/playground/playground.tsx \
  docs/src/components/playground/playground.css \
  docs/test/playground-runtime.spec.ts \
  docs/test/playground.spec.tsx \
  docs/scripts/docs-pages-smoke.mjs
git commit -m "fix(docs): keep playground runtime warm"
```

