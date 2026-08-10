# Interactive Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/playground/` page where readers can edit and manually run six strict TypeScript `@favy/di@3.0.0` examples, with public npm dependencies detected after one idle second.

**Architecture:** A Starlight page mounts one React playground island. The parent keeps per-example drafts and dependency sets, while one keyed Sandpack provider owns the active editor and isolated runtime; dependency changes remount that provider without running code, and an explicit run request targets exactly one provider generation. Pure dependency parsing and immutable examples live in separate modules so they can be tested without Sandpack.

**Tech Stack:** Astro/Starlight, React 18, TypeScript, `@codesandbox/sandpack-react@2.20.0`, `es-module-lexer@2.3.1`, Jest 29 with Testing Library, bare Playwright smoke script.

## Global Constraints

- Keep every existing Monaco-backed article editor unchanged, including `docs/src/components/editor.tsx`.
- Pin playground imports of `@favy/di` to `3.0.0`; use `latest` for every other detected public npm package.
- Use Sandpack's `vanilla-ts` template with `autorun: false` and `autoReload: false`.
- Mount exactly one `SandpackProvider`; switching examples destroys the old runtime and console while retaining its draft in React memory.
- Do not add sharing, private-package credentials, multi-file editing, or changes to the unused `docs/src/components/sandbox.astro` experiment.
- Scan imports 1,000 ms after the last edit without executing code. A manual Run flushes the pending scan and then executes exactly once.
- Treat relative, absolute, URL, data, and `node:` specifiers as non-npm imports. Support static imports, re-exports, and string-literal dynamic imports.
- All controls must be keyboard-operable, visibly focused, and at least 44 by 44 CSS pixels. The page must not overflow horizontally at 320 px.
- User code runs only in Sandpack's isolated iframe and is never persisted by application code.
- Do not attempt to repair the documented clean-worktree Monaco hover smoke failure in this feature.
- Never add a Codex or Anthropic `Co-Authored-By` commit trailer.

## File Map

- `docs/src/components/playground/playground-dependencies.ts`: parse and normalize npm specifiers; no React state.
- `docs/src/components/playground/playground-examples.ts`: six immutable example records and their initial TypeScript sources.
- `docs/src/components/playground/playground.tsx`: navigation, drafts, debounce, dependency/provider generations, Run/Reset, theme, and Sandpack UI.
- `docs/src/components/playground/playground.css`: page-scoped desktop/mobile layout and accessible states.
- `docs/src/content/docs/playground.mdx`: Starlight page and client-loaded island.
- `docs/test/*.spec.ts(x)`: parser, strict example compilation, and lifecycle/component contracts.
- `docs/scripts/docs-pages-smoke.mjs`: real-browser playground coverage with a focused `PLAYGROUND_ONLY=1` mode that bypasses the unrelated Monaco baseline failure.
- `docs/astro.config.mjs`, `docs/src/components/docs-page-title.astro`, `docs/public/llms.txt`: navigation and documentation discovery.

---

### Task 1: Install Sandpack and implement deterministic dependency extraction

**Files:**
- Modify: `docs/package.json`
- Modify: `docs/package-lock.json`
- Create: `docs/jest.config.ts`
- Create: `docs/tsconfig.spec.json`
- Create: `docs/test/style-mock.js`
- Create: `docs/test/playground-dependencies.spec.ts`
- Create: `docs/src/components/playground/playground-dependencies.ts`

**Interfaces:**
- Consumes: `parse(source: string)` from `es-module-lexer/js`.
- Produces: `PlaygroundDependencies`, `DependencyResolution`, `resolvePlaygroundDependencies(source: string): DependencyResolution`, and `dependencySignature(dependencies: PlaygroundDependencies): string`.

- [ ] **Step 1: Install exact runtime dependencies and add the inferred Jest project configuration**

Run:

```bash
npm install --prefix docs --save-exact \
  @codesandbox/sandpack-react@2.20.0 \
  es-module-lexer@2.3.1
```

Create `docs/jest.config.ts`:

```ts
/* eslint-disable */
export default {
  displayName: 'docs',
  preset: '../jest.preset.js',
  roots: ['<rootDir>/test'],
  testEnvironment: 'jsdom',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: { '\\.css$': '<rootDir>/test/style-mock.js' },
  coverageDirectory: '../coverage/docs',
};
```

Create `docs/test/style-mock.js` so the later component CSS import stays outside Jest:

```js
module.exports = {};
```

Create `docs/tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/out-tsc",
    "module": "commonjs",
    "moduleResolution": "node",
    "verbatimModuleSyntax": false,
    "types": ["jest", "node"]
  },
  "include": [
    "jest.config.ts",
    "test/**/*.spec.ts",
    "test/**/*.spec.tsx",
    "src/**/*.d.ts"
  ]
}
```

The existing `@nx/jest/plugin` infers `docs:test`; do not edit `nx.json` or `docs/project.json`.

- [ ] **Step 2: Write the dependency extractor tests**

Create table-driven tests that make these exact assertions:

```ts
import {
  dependencySignature,
  resolvePlaygroundDependencies,
} from '../src/components/playground/playground-dependencies';

describe('resolvePlaygroundDependencies', () => {
  it('extracts, normalizes, pins, deduplicates, and sorts npm packages', () => {
    expect(
      resolvePlaygroundDependencies(`
        import { Module } from '@favy/di';
        import fp from 'lodash/fp';
        export { value } from '@scope/pkg/subpath';
        void import('zod');
        void import(variable);
        void import('lodash/map');
      `),
    ).toEqual({
      ok: true,
      dependencies: {
        '@favy/di': '3.0.0',
        '@scope/pkg': 'latest',
        lodash: 'latest',
        zod: 'latest',
      },
    });
  });

  it.each([
    "import './local';",
    "import '../parent';",
    "import '/absolute';",
    "import 'https://esm.sh/zod';",
    "import 'http://example.test/pkg';",
    "import 'data:text/javascript,export default 1';",
    "import 'node:fs';",
  ])('ignores non-package specifiers in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({
      ok: true,
      dependencies: {},
    });
  });

  it.each(["import {", "import value from '", "void import('pkg"])(
    'reports incomplete import syntax without inventing dependencies',
    (source) => expect(resolvePlaygroundDependencies(source)).toEqual({ ok: false }),
  );

  it('creates a stable provider key independent of insertion order', () => {
    expect(dependencySignature({ zod: 'latest', '@favy/di': '3.0.0' })).toBe(
      '@favy/di@3.0.0|zod@latest',
    );
  });
});
```

- [ ] **Step 3: Run the focused test and confirm it fails because the module is missing**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-dependencies.spec.ts
```

Expected: FAIL with `Cannot find module '../src/components/playground/playground-dependencies'`.

- [ ] **Step 4: Implement the pure extractor**

Use the synchronous pure-JavaScript lexer entry so no WASM initialization state leaks into React:

```ts
import { parse } from 'es-module-lexer/js';

export type PlaygroundDependencyVersion = '3.0.0' | 'latest';
export type PlaygroundDependencies = Readonly<
  Record<string, PlaygroundDependencyVersion>
>;
export type DependencyResolution =
  | { readonly ok: true; readonly dependencies: PlaygroundDependencies }
  | { readonly ok: false };

const packageName = (specifier: string): string | undefined => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('http:') ||
    specifier.startsWith('https:') ||
    specifier.startsWith('data:')
  ) {
    return undefined;
  }

  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0] || undefined;
};

export const resolvePlaygroundDependencies = (
  source: string,
): DependencyResolution => {
  try {
    const names = parse(source)[0]
      .map(({ n }) => (n ? packageName(n) : undefined))
      .filter((name): name is string => name !== undefined);
    const dependencies = Object.fromEntries(
      [...new Set(names)]
        .sort((left, right) => left.localeCompare(right))
        .map((name) => [name, name === '@favy/di' ? '3.0.0' : 'latest']),
    ) as Record<string, PlaygroundDependencyVersion>;
    return { ok: true, dependencies };
  } catch {
    return { ok: false };
  }
};

export const dependencySignature = (
  dependencies: PlaygroundDependencies,
): string =>
  Object.entries(dependencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`)
    .join('|');
```

- [ ] **Step 5: Run the focused test and type-check the test project**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-dependencies.spec.ts
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the parser slice**

```bash
git add docs/package.json docs/package-lock.json docs/jest.config.ts \
  docs/tsconfig.spec.json docs/test/style-mock.js \
  docs/test/playground-dependencies.spec.ts \
  docs/src/components/playground/playground-dependencies.ts
git commit -m "feat(docs): resolve playground dependencies"
```

---

### Task 2: Add six strict, deterministic example programs

**Files:**
- Create: `docs/src/components/playground/playground-examples.ts`
- Create: `docs/test/playground-examples.spec.ts`

**Interfaces:**
- Consumes: public exports from `di/src/index.ts` through the `@favy/di` path mapping.
- Produces: `PlaygroundExampleId`, `PlaygroundExample`, `playgroundExamples`, and `playgroundExampleById`.

- [ ] **Step 1: Write a real TypeScript-program compilation test**

The test must use `ts.createProgram`, not `transpileModule`, so imported library types and strict errors are checked:

```ts
import path from 'node:path';
import ts from 'typescript';
import { playgroundExamples } from '../src/components/playground/playground-examples';

const workspace = path.resolve(__dirname, '../..');

const diagnosticsFor = (id: string, source: string): readonly ts.Diagnostic[] => {
  const filename = path.join(workspace, 'docs', 'test', '__virtual__', `${id}.ts`);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: workspace,
    paths: { '@favy/di': ['di/src/index.ts'] },
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists;
  const originalReadFile = host.readFile;
  const originalGetSourceFile = host.getSourceFile;
  host.fileExists = (file) => file === filename || originalFileExists(file);
  host.readFile = (file) => (file === filename ? source : originalReadFile(file));
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
    file === filename
      ? ts.createSourceFile(file, source, languageVersion, true)
      : originalGetSourceFile(file, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([filename], options, host);
  return ts.getPreEmitDiagnostics(program);
};

it('ships six standalone strict TypeScript examples', () => {
  expect(playgroundExamples.map(({ id }) => id)).toEqual([
    'basic',
    'composition',
    'replace',
    'partial',
    'lazy-cache',
    'hkt',
  ]);
  for (const example of playgroundExamples) {
    const diagnostics = diagnosticsFor(example.id, example.source);
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
    ).toEqual([]);
    expect(example.source).toContain('console.log');
  }
});
```

- [ ] **Step 2: Run the test and confirm it fails because the examples module is missing**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-examples.spec.ts
```

Expected: FAIL with a missing `playground-examples` module.

- [ ] **Step 3: Implement immutable metadata and the six exact source programs**

Define:

```ts
export type PlaygroundExampleId =
  | 'basic'
  | 'composition'
  | 'replace'
  | 'partial'
  | 'lazy-cache'
  | 'hkt';

export type PlaygroundExample = Readonly<{
  id: PlaygroundExampleId;
  title: string;
  description: string;
  source: string;
}>;
```

The array must use these standalone programs:

```ts
const basic = `import { Module } from '@favy/di';

const Greeting = Module<{ name: string }>()(
  'Greeting',
  ({ name }) => \`Hello, \${name}!\`,
);

console.log(Greeting({ name: 'Ada' })); // Hello, Ada!`;

const composition = `import { Module, type Live } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => '2026-08-04T09:00:00.000Z',
}));
type ClockLive = Live<typeof Clock>;

const Timestamp = Module<ClockLive>()(
  'Timestamp',
  ({ Clock }) => \`Built at \${Clock.now()}\`,
);

console.log(Timestamp({ Clock })); // Built at 2026-08-04T09:00:00.000Z`;

const replace = `import { Module, type Live } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => new Date().toISOString(),
}));
type ClockLive = Live<typeof Clock>;

const Timestamp = Module<ClockLive>()(
  'Timestamp',
  ({ Clock }) => \`Built at \${Clock.now()}\`,
);

const FixedClock: ReturnType<typeof Clock> = {
  now: () => '2000-01-01T00:00:00.000Z',
};

console.log(Timestamp({ Clock: FixedClock }));
// Built at 2000-01-01T00:00:00.000Z`;

const partial = `import { Module } from '@favy/di';

const Add = Module<{ left: number; right: number }>()(
  'Add',
  ({ left, right }) => left + right,
);

const AddTen = Add.provide({ left: 10 });

console.log(AddTen({ right: 5 })); // 15`;

const lazyCache = `import { Module, type Live } from '@favy/di';

let resourceRuns = 0;
const Resource = Module()('Resource', () => ++resourceRuns);
type ResourceLive = Live<typeof Resource>;

const Ignore = Module<ResourceLive>()('Ignore', () => 'unused');
console.log(Ignore({ Resource }), resourceRuns); // unused 0

const ReadTwice = Module<ResourceLive>()(
  'ReadTwice',
  (deps) => [deps.Resource, deps.Resource],
);

console.log(ReadTwice({ Resource })); // [1, 1]
console.log(ReadTwice({ Resource })); // [2, 2]`;

const hkt = `import {
  makeModule,
  type HKT,
  type ModuleLive,
  type TModule,
} from '@favy/di';

type Box<Name, Result> = { name: Name; value: Result };
type BoxedModule<Name extends PropertyKey, Result, Deps> =
  TModule<Name, Deps, Box<Name, Result>>;

interface BoxHKT extends HKT {
  readonly type: BoxedModule<
    this['_NAME'],
    this['_RESULT'],
    this['_DEPS']
  >;
}

const BoxModule = makeModule({
  transformOutput: (result, deps) => ({
    name: (deps as unknown as ModuleLive).Module.name,
    value: result,
  }) as unknown as BoxHKT,
});

const Greeting = BoxModule()('Greeting', () => 'hello');
const output = Greeting();
const name: 'Greeting' = output.name;
const value: string = output.value;

console.log(\`\${name}: \${value}\`); // Greeting: hello`;
```

Build `playgroundExamples` with these exact records:

| ID | Title | Description |
| --- | --- | --- |
| `basic` | Basic module | Create and call one named module. |
| `composition` | Composition | Compose a timestamp from a typed clock provider. |
| `replace` | Replace a boundary | Supply a deterministic clock value at the composition root. |
| `partial` | Partial application | Bind one dependency with `.provide()` and keep the remainder typed. |
| `lazy-cache` | Lazy and cache | Skip an unused provider and reuse one value within each run. |
| `hkt` | HKT transform | Wrap a result while preserving the module name and callback result type. |

Freeze the array with `Object.freeze`, then create the lookup without mutable aliases:

```ts
export const playgroundExampleById = Object.freeze(
  Object.fromEntries(
    playgroundExamples.map((example) => [example.id, example]),
  ) as Record<PlaygroundExampleId, PlaygroundExample>,
);
```

Do not make any source import a package it does not use.

- [ ] **Step 4: Run compilation, parser, and docs type checks**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern='playground-(examples|dependencies).spec.ts'
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: PASS with six examples and no TypeScript diagnostics.

- [ ] **Step 5: Commit the example slice**

```bash
git add docs/src/components/playground/playground-examples.ts \
  docs/test/playground-examples.spec.ts
git commit -m "feat(docs): add playground examples"
```

---

### Task 3: Build the single-provider playground lifecycle with tests

**Files:**
- Create: `docs/test/playground.spec.tsx`
- Create: `docs/src/components/playground/playground.tsx`

**Interfaces:**
- Consumes: `playgroundExamples`, `playgroundExampleById`, `resolvePlaygroundDependencies`, `dependencySignature`, and Sandpack React hooks/components.
- Produces: `Playground(): JSX.Element` and accessible controls named `Example`, `Reset example`, and `Run code`.

- [ ] **Step 1: Mock only the Sandpack boundary in the component test**

Use a Jest mock with a React context. Its provider keeps `/index.ts` in state, logs mount/unmount and the current `customSetup.dependencies`, and exposes:

```ts
type MockSandpackContext = {
  code: string;
  setCode(code: string): void;
  runSandpack: jest.Mock<Promise<void>, []>;
  listen(listener: (message: { type: string }) => void): () => void;
};
```

Render `SandpackCodeEditor` as a controlled `<textarea aria-label="TypeScript playground editor">`, `SandpackConsole` as `<div aria-label="Console output" />`, `useActiveCode()` from the context, and `useSandpack()` as `{ sandpack: context }`. Have the mocked `runSandpack()` append `run:<dependency signature>` to an event log and notify listeners with `{ type: 'done' }` on the next timer tick.

- [ ] **Step 2: Write lifecycle tests before the component exists**

Use `jest.useFakeTimers()`, `render`, `screen`, `fireEvent`, and `act`. Assert:

```ts
it('mounts one provider, restores drafts, and resets only the active example');
it('waits 1000 ms before remounting for a valid new import');
it('keeps the last valid dependency generation for an incomplete import');
it('flushes a pending scan, remounts, and runs exactly once');
it.each([{ key: 'Control' }, { key: 'Meta' }])(
  'runs with $key+Enter',
);
```

The central manual-run assertion must prove ordering, not only call count:

```ts
fireEvent.change(editor, {
  target: { value: `${initialCode}\nimport 'lodash/fp';` },
});
fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
await act(async () => jest.runAllTimersAsync());

expect(events.filter((event) => event.startsWith('run:'))).toEqual([
  'run:@favy/di@3.0.0|lodash@latest',
]);
expect(maximumMountedProviders).toBe(1);
```

For switching, edit Basic, click the `Composition` tab/button, return to `Basic module`, and expect the textarea to contain the edit while the console node has a new mount id. For Reset, expect the original Basic source and a new provider mount. For incomplete import, advance 1,000 ms and expect the provider generation/dependency log not to change.

- [ ] **Step 3: Run the component test and confirm the missing component failure**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground.spec.tsx
```

Expected: FAIL because `playground.tsx` does not exist.

- [ ] **Step 4: Implement parent state and stable generation identities**

Use these explicit state shapes:

```ts
type PlaygroundStatus =
  | 'Ready'
  | 'Checking imports'
  | 'Preparing dependencies'
  | 'Running'
  | 'Failed';

type EditorSnapshot = Readonly<{
  hadFocus: boolean;
  anchor: number;
  head: number;
}>;

type RunRequest = Readonly<{
  token: number;
  sandboxKey: string;
}>;

type SandboxHandle = {
  readCode(): string;
  captureEditor(): EditorSnapshot | undefined;
};
```

Initialize drafts and dependency maps from all six sources exactly once. Derive the active provider key as:

```ts
const sandboxKey = [
  selectedId,
  resetGeneration[selectedId],
  dependencySignature(dependencies[selectedId]),
].join(':');
```

On every code change, save the draft, set `Checking imports`, clear the existing timeout, and schedule one scan at 1,000 ms. A failed scan leaves the dependency map and provider key unchanged. A valid changed scan captures the editor code/selection/focus, updates the dependency map, sets `Preparing dependencies`, and lets the new keyed provider report `Ready` after mount; it does not create a `RunRequest`.

On Run, cancel the debounce and synchronously scan `sandboxRef.current.readCode()`. If dependencies changed, update them and target the computed next `sandboxKey`; otherwise target the current key. Set `RunRequest` to `{ token: ++runCounter.current, sandboxKey: targetKey }` and immediately set `Preparing dependencies` or `Running`. Disable Run in those two states.

On example change or Reset, cancel the timer and clear `RunRequest`. Reset also restores the immutable source, restores its detected dependencies, and increments that example's reset generation.

- [ ] **Step 5: Implement the keyed Sandpack session without accidental autorun**

Keep both reference-sensitive provider inputs stable for the entire generation:

```tsx
const SANDBOX_OPTIONS = Object.freeze({
  activeFile: '/index.ts',
  autorun: false,
  autoReload: false,
});

const [files] = useState(() => ({ '/index.ts': initialCode }));
const customSetup = useMemo(
  () => ({ entry: '/index.ts', dependencies }),
  [dependencies],
);

return (
  <SandpackProvider
    template="vanilla-ts"
    files={files}
    customSetup={customSetup}
    options={SANDBOX_OPTIONS}
    theme={theme}
  >
    <SandboxContents {...contentsProps} />
  </SandpackProvider>
);
```

Never inline `files`/`customSetup`, and never feed each parent draft update back into the provider: Sandpack 2.20.0 treats their identities as reset signals and can update an existing preview despite `autoReload: false`.

Inside `SandboxContents`, use `useActiveCode()` to report edits upward and expose the live source through `useImperativeHandle`. Render `SandpackCodeEditor` with line numbers, no built-in tabs or run button, and immediate initialization. Render `<SandpackConsole standalone />`; without `standalone`, a console-only layout has no hidden client to execute.

Capture CodeMirror focus and selection from the editor ref's `getCodemirror()` before a dependency remount. Restore the selection with `view.dispatch({ selection: { anchor, head } })` and call `view.focus()` only when `hadFocus` was true, after the replacement immediate editor exists. Cancel the scheduled restoration on unmount.

- [ ] **Step 6: Implement exactly-once manual execution and status updates**

The run effect acts only when `runRequest.sandboxKey === sandboxKey` and the token is newer than its handled ref. It must register the Sandpack message listener before launch, then schedule the launch with a cancelable zero-delay timer so the standalone console can register its hidden client:

```ts
useEffect(() => {
  if (!runRequest || runRequest.sandboxKey !== sandboxKey) return;
  const timer = window.setTimeout(() => {
    if (runRequest.token <= handledRun.current) return;
    handledRun.current = runRequest.token;
    const stop = sandpack.listen((message) => {
      if (message.type === 'done') {
        onStatus(message.compilatonError ? 'Failed' : 'Ready');
        onRunSettled(runRequest.token);
        stop();
      }
      if (message.type === 'action' && message.action === 'show-error') {
        onStatus('Failed');
      }
    });
    void sandpack.runSandpack().catch(() => {
      stop();
      onStatus('Failed');
      onRunSettled(runRequest.token);
    });
  }, 0);
  return () => window.clearTimeout(timer);
}, [runRequest, sandboxKey, sandpack, onRunSettled, onStatus]);
```

Narrow the message with `message.type` before accessing action-specific fields and preserve Sandpack 2.20.0's published misspelling `compilatonError`. Start a 30,000 ms failure timeout immediately before `runSandpack()` and clear it on `done`, launch rejection, or unmount so a missing terminal message cannot leave Run disabled forever. Do not use `sandpack.status === 'done'` because this version never enters that state.

Add a `keydown` handler scoped to the playground root. For Ctrl+Enter and Cmd+Enter, call `preventDefault()` and the same Run handler as the button; ignore repeated shortcuts while Run is disabled.

Observe `document.documentElement.dataset.theme` with `MutationObserver` and pass only `'light'` or `'dark'` to Sandpack. Keep this local; do not refactor the Monaco editor.

- [ ] **Step 7: Run component tests and the full docs unit suite**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground.spec.tsx
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
```

Expected: all tests PASS; the event log proves the new dependency provider mounts before one Run call.

- [ ] **Step 8: Commit the lifecycle slice**

```bash
git add docs/src/components/playground/playground.tsx \
  docs/test/playground.spec.tsx
git commit -m "feat(docs): add interactive playground runtime"
```

---

### Task 4: Add the responsive, accessible playground page

**Files:**
- Create: `docs/src/components/playground/playground.css`
- Create: `docs/src/content/docs/playground.mdx`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/astro.config.mjs`
- Modify: `docs/src/components/docs-page-title.astro`

**Interfaces:**
- Consumes: `Playground` React export and existing `--docs-*` design tokens.
- Produces: canonical `/playground/` route, desktop list navigation, mobile `select`, toolbar, editor, console, and `Playground` page label.

- [ ] **Step 1: Add semantic UI assertions to the component test**

Assert that the rendered component has:

```ts
expect(screen.getByRole('navigation', { name: 'Playground examples' })).toBeTruthy();
expect(screen.getByRole('combobox', { name: 'Example' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Reset example' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Run code' })).toBeTruthy();
expect(screen.getByRole('status').textContent).toContain('Ready');
```

Use native button selected state through `aria-pressed`, `aria-current`, or a selected marker plus text; the selected state must not rely only on color. Use `aria-live="polite"` for status and `aria-busy` while preparing/running.

- [ ] **Step 2: Run the test and confirm missing semantic controls fail**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground.spec.tsx
```

Expected: FAIL on at least the navigation, combobox, or status query.

- [ ] **Step 3: Render the approved layout and page copy**

The component root must be `<section className="playground not-content" aria-label="TypeScript playground">`. Render:

- a desktop `<nav aria-label="Playground examples">` with one real button per example, title, one-sentence description, and a non-color selected marker;
- a mobile `<label>` plus native `<select aria-label="Example">` with the same six titles;
- toolbar buttons ordered Reset then Run, with the shortcut shown as text;
- a `role="status"` text node for `Ready`, `Checking imports`, `Preparing dependencies`, `Running`, or `Failed`;
- editor and console regions with visible headings/accessibility labels.

Create `docs/src/content/docs/playground.mdx`:

```mdx
---
title: Playground
description: Edit and run focused @favy/di examples directly in the browser.
tableOfContents: false
---

import { Playground } from '../../components/playground/playground';

Choose an example, change the TypeScript, and run it when you are ready.
Public npm imports are detected after you stop typing; your code stays in this
browser tab.

<div className="playground-page">
  <Playground client:load />
</div>
```

The import is exactly two directories up from `src/content/docs` into `src/components`; keep the shown path.

- [ ] **Step 4: Implement page-scoped responsive CSS**

Import `./playground.css` from `playground.tsx`. Use existing tokens and these layout contracts:

```css
.playground {
  display: grid;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  gap: 1rem;
  max-inline-size: 100%;
  margin-block: 2rem;
}

.playground__workspace {
  min-inline-size: 0;
  overflow: hidden;
  border: 1px solid var(--docs-border);
  border-radius: var(--docs-radius-lg);
  background: var(--docs-surface-raised);
  box-shadow: var(--docs-shadow);
}

.playground :is(button, select) {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
}

.playground :is(button, select):focus-visible {
  outline: 3px solid color-mix(in srgb, var(--docs-accent) 72%, white);
  outline-offset: 2px;
}

@media (max-width: 47.999rem) {
  .playground { grid-template-columns: minmax(0, 1fr); }
  .playground__desktop-nav { display: none; }
  .playground__mobile-nav { display: grid; }
}

@media (min-width: 48rem) {
  .playground__desktop-nav { display: grid; }
  .playground__mobile-nav { display: none; }
}
```

Set all intermediate grid/flex children to `min-inline-size: 0`. Set the editor to `block-size: 28rem` and console to `block-size: 12rem`; at widths below 48rem use 24rem and 10rem respectively, with scrolling inside each Sandpack region. Reset margin/border on `.sp-wrapper`, `.sp-layout`, and `.sp-stack` where the workspace already supplies the surface. Add a page-local global selector using `:has(.playground-page)` to raise `--sl-content-width` to `76rem` only on this route. Do not change the global 45rem width for article pages.

- [ ] **Step 5: Integrate navigation and page labeling**

In `docs/astro.config.mjs`, make `Getting started` exactly:

```js
items: [
  { label: 'Introduction', slug: 'guides/introduction' },
  { label: 'Playground', slug: 'playground' },
],
```

In `docs-page-title.astro`, check `slug === 'playground'` before the existing guide/reference/advanced/core branches and return `Playground`.

- [ ] **Step 6: Run unit, Astro check, and production build**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
```

Expected: all commands PASS and the build emits `dist/docs/browser/playground/index.html` (or the Nx-configured equivalent path).

- [ ] **Step 7: Commit the page slice**

```bash
git add docs/src/components/playground/playground.css \
  docs/src/components/playground/playground.tsx \
  docs/src/content/docs/playground.mdx docs/astro.config.mjs \
  docs/src/components/docs-page-title.astro
git commit -m "feat(docs): publish playground page"
```

---

### Task 5: Verify the real browser contract and publish the discovery link

**Files:**
- Modify: `docs/scripts/docs-pages-smoke.mjs`
- Modify: `docs/public/llms.txt`

**Interfaces:**
- Consumes: `/playground/`, accessible names from Task 4, and `PLAYGROUND_ONLY=1`.
- Produces: focused real-Sandpack smoke coverage and the canonical `https://di.favy.dev/playground/` llms resource.

- [ ] **Step 1: Add a focused playground smoke function before the existing article checks**

Extract a `checkPlayground(page)` function and call it before navigating to Introduction. It must:

1. load `${origin}/playground/` at 1440×1000;
2. assert the title label and heading are both `Playground`;
3. assert six desktop example buttons and exactly one Sandpack provider/editor;
4. run Basic with Ctrl+Enter and wait for console text `Hello, Ada!`;
5. replace the source with an incomplete import, wait 1,100 ms, and assert the status is `Checking imports` while the page stays responsive;
6. click Reset, run again, and observe `Hello, Ada!`;
7. check every example, Reset, and Run control with `assertMinimumTargetSize`;
8. switch to 320×900, assert the native Example select is visible, select HKT, assert no horizontal overflow, use Cmd+Enter, and wait for `Greeting: hello`.

Use accessible locators, for example:

```js
const editor = page.getByLabel('TypeScript playground editor');
await editor.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
await page.getByLabel('Console output').getByText('Hello, Ada!').waitFor({
  timeout: 30_000,
});
```

At the top-level flow, add:

```js
await checkPlayground(page);
if (process.env.PLAYGROUND_ONLY === '1') {
  console.log('Playground page contract passed');
  process.exitCode = 0;
} else {
  await checkExistingDocumentationPages(page);
}
```

Do not hide or remove the existing Monaco hover assertion; focused mode exists solely so this feature has a green browser gate while the documented unrelated baseline remains visible in the full run.

- [ ] **Step 2: Run the smoke before implementation and confirm the new assertions fail**

Start the docs server in a separate terminal:

```bash
npx nx run docs:dev
```

Then run:

```bash
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4321 \
  node docs/scripts/docs-pages-smoke.mjs
```

Expected before the smoke/page contract is complete: FAIL on the first unmet `/playground/` assertion.

- [ ] **Step 3: Finish locators and lifecycle behavior until focused smoke passes**

If the real Sandpack console wraps values in separate elements, scope text locators to `[aria-label="Console output"]` but keep the deterministic strings unchanged. Fix production behavior or accessible names; do not weaken timing, count, size, overflow, run, or recovery assertions.

Run the focused smoke again and expect `Playground page contract passed` with exit code 0.

- [ ] **Step 4: Add the canonical llms link**

Under `## Optional` in `docs/public/llms.txt`, add before the transform pages:

```md
- [Playground](https://di.favy.dev/playground/): Edit and run six focused @favy/di examples in an isolated browser sandbox.
```

- [ ] **Step 5: Run the full verification matrix**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4321 \
  node docs/scripts/docs-pages-smoke.mjs
git diff --check
```

Expected: every command PASS. Then run the existing full smoke once without `PLAYGROUND_ONLY`; if it stops at the known Monaco hover assertion, record that exact baseline separately and verify it is unchanged rather than editing Monaco-related files.

- [ ] **Step 6: Review scope and commit the browser/docs slice**

Run:

```bash
git diff --name-only HEAD~4
git status --short
```

Confirm there is no change to `docs/src/components/editor.tsx`, `docs/src/components/sandbox.astro`, library source under `di/src`, or the untracked `.superpowers/` companion directory. Then commit:

```bash
git add docs/scripts/docs-pages-smoke.mjs docs/public/llms.txt
git commit -m "test(docs): cover interactive playground"
```

---

### Task 6: Final review and PR update

**Files:**
- Review only: every file committed in Tasks 1–5
- Do not add: `.superpowers/`

**Interfaces:**
- Consumes: all verification commands and global constraints above.
- Produces: one reviewed, pushed branch update for existing PR #3.

- [ ] **Step 1: Inspect the complete diff and commit history**

Run:

```bash
git diff ffad381..HEAD --stat
git diff ffad381..HEAD -- docs/src/components/editor.tsx \
  docs/src/components/sandbox.astro di/src
git log --oneline ffad381..HEAD
```

Expected: the protected paths have no diff; commits contain no co-author trailers.

- [ ] **Step 2: Re-run evidence-producing checks from a clean process**

Stop and restart the docs dev server, then run the Task 5 verification matrix once. Capture the command outputs for the handoff; do not claim success from an earlier cached run.

- [ ] **Step 3: Perform a focused code review**

Verify all of the following directly in the diff and tests:

- no parent draft object is passed back to a live provider after each keystroke;
- `files` and `customSetup` are stable within a keyed provider generation;
- dependency-only remounts do not create a run request;
- a Run request names one exact sandbox key and cannot replay after switch/reset/remount;
- listener/timer/MutationObserver cleanup executes on unmount;
- invalid imports retain the last valid dependency set;
- only the selected example is mounted;
- all six original examples compile and log deterministic output;
- desktop and mobile controls meet the 44px and overflow contracts.

- [ ] **Step 4: Push the reviewed commits to the existing feature branch**

Run:

```bash
git push origin readme-llms-v3
```

Expected: existing PR #3 updates; do not create a second PR.
