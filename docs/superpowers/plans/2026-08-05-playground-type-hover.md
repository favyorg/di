# Playground Type Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use one Monaco/TypeScript editor layer for documentation examples and the playground so hovering `@favy/di` and inferred HKT values shows real quick-info.

**Architecture:** Extract Monaco initialization, local library declarations, theme synchronization, and editor/ref behavior into one controlled component. Ordinary examples and the playground share it; Sandpack remains only the dependency/runtime provider. Playground-only automatic typings load after validated imports without entering the warm Run path.

**Tech Stack:** React 18, Monaco Editor 0.52, `@monaco-editor/react`, `monaco-editor-auto-typings`, Sandpack 2.20, Jest/jsdom, Astro, Playwright.

## Global Constraints

- Keep the existing dependency-keyed Sandpack provider, warmed Nodebox, static runner, exact `fs/change` handshake, and 30–93 ms warm Run architecture unchanged.
- Register both Monaco TypeScript modules before creating any TypeScript model: `vs/basic-languages/typescript/typescript.contribution` and `vs/language/typescript/monaco.contribution`.
- Load local `@favy/di` sources exactly once per browser page; bundled HKT hover must require no registry or CDN request.
- Preserve first-paint highlighted playground fallback, drafts, Reset, example switching, dependency debounce, focus/selection restoration, keyboard Run, and accessible editor naming.
- Use `monaco-editor-auto-typings/custom-editor`; debounce external declarations by `1_000` ms, cache them in local storage, and dispose them with the playground editor.
- Monaco/TypeScript initialization may run in parallel with runtime warmup but must never be included in warm Run timing or trigger a repeated download during Run.
- Never touch or stop the user's server on port 4321. Use the branch server on 4324 for new browser verification until final handoff.
- Do not stage `.superpowers/` and do not add any `Co-Authored-By` trailer.

---

### Task 1: Build the shared Monaco/TypeScript editor and fix ordinary docs hover

**Files:**
- Create: `docs/src/components/typescript-editor.tsx`
- Modify: `docs/src/components/editor.tsx`
- Create: `docs/test/typescript-editor.spec.tsx`
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Produces:

```ts
export type TypeScriptEditorSnapshot = Readonly<{
  hadFocus: boolean;
  anchor: number;
  head: number;
}>;

export type TypeScriptEditorHandle = {
  readValue(): string;
  capture(): TypeScriptEditorSnapshot | undefined;
  restore(snapshot: TypeScriptEditorSnapshot): void;
};

export type TypeScriptEditorProps = Readonly<{
  value: string;
  onChange?(value: string): void;
  height: number | string;
  modelPath: string;
  ariaLabel: string;
  fallback: ReactNode;
  readOnly?: boolean;
  onReady?(): void;
}>;

export const TypeScriptEditor: ForwardRefExoticComponent<
  TypeScriptEditorProps & RefAttributes<TypeScriptEditorHandle>
>;
```

- The loader remains private to `typescript-editor.tsx`; all consumers use `TypeScriptEditor`.
- Task 2 consumes `TypeScriptEditor`, `TypeScriptEditorHandle`, and `TypeScriptEditorSnapshot` exactly as declared.

- [ ] **Step 1: Capture the browser RED for ordinary docs hover**

Run the fresh server and the full docs smoke path against 4324:

```bash
DOCS_URL=http://127.0.0.1:4324 node docs/scripts/docs-pages-smoke.mjs
```

Expected current failure: the introduction model reports `plaintext`, no visible `.monaco-hover` appears over `Module`, or `getTypeScriptWorker()` reports `TypeScript not registered`.

- [ ] **Step 2: Add failing shared-editor unit tests**

Create `typescript-editor.spec.tsx` with controlled mocks for `@monaco-editor/react` and Monaco's editor API. The tests must verify observable behavior:

```tsx
it('keeps the fallback until Monaco is ready', async () => {
  render(<TypeScriptEditor {...props} fallback={<pre>fallback</pre>} />);
  expect(screen.getByText('fallback')).toBeTruthy();
  await act(async () => flushDynamicImports());
  await screen.findByRole('textbox', { name: 'TypeScript example' });
});

it('forwards controlled edits and restores focus and selection', async () => {
  const onChange = jest.fn();
  const ref = createRef<TypeScriptEditorHandle>();
  render(<TypeScriptEditor {...props} ref={ref} onChange={onChange} />);
  fireEvent.change(await editorTextarea(), { target: { value: 'const n = 1' } });
  expect(onChange).toHaveBeenLastCalledWith('const n = 1');
  ref.current?.restore({ hadFocus: true, anchor: 6, head: 7 });
  expect(mockEditorSelection()).toEqual({ anchor: 6, head: 7 });
  expect(mockEditorHasFocus()).toBe(true);
});
```

Also assert that two mounted editors receive different `modelPath` values and local type libraries are registered once. The production mutation caught by the tests is duplicate model/library setup or a component that cannot preserve controlled editor state; the real TypeScript registration mutation is covered by the browser test from Step 1.

- [ ] **Step 3: Verify unit RED**

```bash
npx nx test docs --skip-nx-cache --runInBand --testPathPattern=typescript-editor.spec.tsx
```

Expected: FAIL because `TypeScriptEditor` does not exist.

- [ ] **Step 4: Implement the shared editor**

Move the raw `@favy/di` sources and ambient module declaration from `editor.tsx` into `typescript-editor.tsx`. Initialize Monaco once with this exact dependency order:

```ts
const monacoReady = Promise.all([
  import('monaco-editor/esm/vs/editor/editor.api'),
  import(
    'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
  ),
  import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
  import('monaco-editor/esm/vs/editor/editor.worker?worker'),
  import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
]).then(([monaco, , , { default: EditorWorker }, { default: TypeScriptWorker }]) => {
  self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      return label === 'typescript' || label === 'javascript'
        ? new TypeScriptWorker()
        : new EditorWorker();
    },
  };
  loader.config({ monaco });
  configureTypeScript(monaco);
});
```

`configureTypeScript()` must set strict options and add the four local source files plus ambient declaration behind one module-level boolean. `TypeScriptEditor` renders `fallback` until preparation succeeds, follows `data-theme`, uses `path={modelPath}` and `language="typescript"`, sets Monaco's `ariaLabel` and automatic accessibility support, implements the ref contract using Monaco offsets, and leaves the fallback in place if loading rejects.

- [ ] **Step 5: Replace ordinary `Editor` setup with the shared component**

Keep `Editor({ code })` as the MDX-facing API. Generate a stable unique model path with a URI-safe encoding of `useId()`, preserve its computed height, local editability, SSR `<pre aria-label="TypeScript example">`, no line numbers, and current font/minimap options. Remove the duplicated loader/types/theme logic from `editor.tsx`.

- [ ] **Step 6: Verify Task 1 GREEN**

```bash
npx nx test docs --skip-nx-cache --runInBand --testPathPattern=typescript-editor.spec.tsx
npx tsc -p docs/tsconfig.spec.json --noEmit
npx nx run docs:check --skip-nx-cache
DOCS_URL=http://127.0.0.1:4324 node docs/scripts/docs-pages-smoke.mjs
```

Expected: unit tests pass; introduction creates a TypeScript model; hovering `Module` shows non-empty `.monaco-hover`; Astro and TypeScript are clean.

- [ ] **Step 7: Commit Task 1**

```bash
git add docs/src/components/typescript-editor.tsx docs/src/components/editor.tsx docs/test/typescript-editor.spec.tsx docs/scripts/docs-pages-smoke.mjs
git commit -m "fix(docs): restore TypeScript example hover"
```

---

### Task 2: Use the controlled Monaco editor in the playground

**Files:**
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/src/components/playground/playground.css`
- Modify: `docs/test/playground.spec.tsx`
- Modify: `docs/src/components/typescript-editor.tsx`
- Modify: `docs/test/typescript-editor.spec.tsx`

**Interfaces:**
- Consumes `TypeScriptEditor`, `TypeScriptEditorHandle`, and `TypeScriptEditorSnapshot` from Task 1.
- Adds this optional prop to `TypeScriptEditorProps`:

```ts
typingVersions?: Readonly<Record<string, string>>;
```

When present, it enables playground-only automatic declaration acquisition. It does not change ordinary docs editors.

- [ ] **Step 1: Add failing playground adapter tests**

Replace the current visible-editor part of the Sandpack mock with a mock of `../src/components/typescript-editor`. Keep Sandpack's provider/client mocks for runtime behavior. The shared editor mock must expose a textarea and the real ref contract.

Add tests that prove:

```tsx
it('uses the controlled TypeScript editor and keeps Sandpack as runtime only', () => {
  render(<Playground />);
  expect(screen.getByRole('textbox', { name: 'TypeScript playground editor' }))
    .toBeTruthy();
  expect(mockVisibleSandpackEditors).toBe(0);
  expect(mockMountedProviders).toBe(1);
});

it('passes validated non-favy versions to automatic typings', () => {
  render(<Playground />);
  edit("import { z } from 'zod';\nvoid z.string();");
  act(() => jest.advanceTimersByTime(1_000));
  expect(latestTypingVersions()).toEqual({ zod: 'latest' });
});
```

Retain the existing draft, Reset, example switch, queued Run, keyboard shortcut, and selection/focus assertions; make them operate through the shared editor mock. Add a rejection test proving an auto-typing failure leaves editing and Run enabled.

- [ ] **Step 2: Verify playground RED**

```bash
npx nx test docs --skip-nx-cache --runInBand --testPathPattern=playground.spec.tsx
```

Expected: FAIL because the playground still renders `SandpackCodeEditor` and does not pass typing versions.

- [ ] **Step 3: Implement the controlled adapter**

Inside `SandboxContents`, keep `useActiveCode()` as the Sandpack file source of truth but render:

```tsx
<TypeScriptEditor
  ref={editorRef}
  value={code}
  onChange={(nextCode) => updateCode(nextCode, false)}
  height="100%"
  modelPath="file:///playground/index.ts"
  ariaLabel="TypeScript playground editor"
  typingVersions={typingVersions}
  fallback={
    <SandpackCodeEditor
      initMode="immediate"
      readOnly
      showLineNumbers
      showRunButton={false}
      showTabs={false}
    />
  }
/>
```

Use `TypeScriptEditorHandle.readValue()` and `.capture()` in `SandboxHandle`; call `.restore()` in the existing restoration effect. Preserve the programmatic-code suppression logic so example switches and Reset do not become user edits.

Add `typingVersions` to `SandboxContentsProps`, derive it in `Playground` from the selected example's validated active dependencies, remove `@favy/di`, and pass the rest through `SandboxSession` to the editor. The Sandpack provider remains keyed exactly as before.

- [ ] **Step 4: Add automatic typings to the shared editor**

When `typingVersions` is present and Monaco has mounted, dynamically import from `monaco-editor-auto-typings/custom-editor` and initialize:

```ts
const autoTypes = await AutoTypings.create(editor, {
  monaco,
  versions: { ...typingVersions },
  onlySpecifiedPackages: true,
  preloadPackages: true,
  shareCache: true,
  sourceCache: new LocalStorageCache(),
  debounceDuration: 1_000,
});
```

Call `setVersions()` when the validated map changes. Dispose the instance on editor unmount and ignore a late `create()` result after cleanup. Catch acquisition failures without changing playground runtime status. Never include `@favy/di` in `typingVersions` because its local source model is authoritative.

- [ ] **Step 5: Adapt playground CSS without changing layout**

Retarget CodeMirror-only editor selectors to Monaco where needed. Preserve editor height, line rhythm, overflow, borders, first-paint fallback, responsive layout, focus outline, and light/dark theme surfaces. Do not add a second editor toolbar or Monaco minimap.

- [ ] **Step 6: Verify Task 2 GREEN**

```bash
npx nx test docs --skip-nx-cache --runInBand --testPathPattern='(typescript-editor|playground)\.spec\.tsx$'
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npx nx run docs:check --skip-nx-cache
git diff --check
```

Expected: all existing runtime behavior and the new Monaco adapter/typing tests pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add docs/src/components/typescript-editor.tsx docs/src/components/playground/playground.tsx docs/src/components/playground/playground.css docs/test/typescript-editor.spec.tsx docs/test/playground.spec.tsx
git commit -m "feat(docs): add playground type hover"
```

---

### Task 3: Add real-browser hover and performance gates

**Files:**
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Consumes the real Monaco DOM from Tasks 1–2 and the existing playground warm-run gate.
- Produces no runtime API; it strengthens merge verification only.

- [ ] **Step 1: Add the failing playground hover gate**

After editor readiness on `/playground/`, locate `Module` in a Monaco `.view-line`, move the mouse to its DOM range, and require:

```js
const hover = page.locator('.monaco-hover:visible');
await hover.waitFor({ timeout: 5_000 });
assert.match(await hover.innerText(), /Module/);
```

Switch to the HKT example, hover the `output` identifier in `const output = Greeting();`, and assert quick-info is non-empty and contains `Box` or `Greeting`. Close the hover before continuing Run measurements.

- [ ] **Step 2: Verify browser RED against the Task 1 base if needed**

Use the report's recorded pre-implementation reproduction if Task 2 has already made the live page green. It must state that Basic `Module`, Basic call `Module`, and HKT import each produced zero tooltip nodes after 2.2 seconds on the pre-change build.

- [ ] **Step 3: Update editor selectors and timing boundaries**

Replace CodeMirror-specific playground assertions with Monaco equivalents while retaining:

- no user output before Run;
- one dependency-keyed Sandpack provider and outer iframe;
- same-node outer iframe across Runs;
- zero post-ready npm registry and preview reload requests;
- true `Ready → Preparing/Running → output → Ready` cycles;
- two warm Runs below 1,000 ms automated and 200 ms locally.

Start warm timing only after Monaco is ready and both hover checks have settled. Clear request collections immediately before the first Run so background language tooling cannot be misclassified as runtime package work; separately assert that no Monaco editor/worker request occurs during either Run.

- [ ] **Step 4: Run repeated browser and full verification**

```bash
for run in 1 2 3; do
  PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4324 \
    node docs/scripts/docs-pages-smoke.mjs
done
npx nx test docs --skip-nx-cache --runInBand
npx tsc -p docs/tsconfig.spec.json --noEmit
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
node --check docs/scripts/docs-pages-smoke.mjs
git diff --check
```

Expected: all three hover/performance runs pass; no warm Run exceeds 200 ms locally; all unit, type, Astro, build, syntax, and diff checks pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add docs/scripts/docs-pages-smoke.mjs
git commit -m "test(docs): verify playground type hover"
```
