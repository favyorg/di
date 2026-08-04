# Interactive documentation playground

## Goal

Add a dedicated `/playground/` documentation page where readers can edit and
run TypeScript examples using `@favy/di@3.0.0`. The page must make several core
and advanced patterns easy to compare without changing the Monaco editors used
inside the existing documentation articles.

## Scope

- Add one Starlight page and expose it in the `Getting started` sidebar group.
- Use Sandpack for the playground editor, dependency bundling, execution, and
  console output.
- Include six curated examples: basic module, composition, boundary
  replacement, partial application, lazy/cache behavior, and HKT.
- Detect public npm imports from edited code and add their dependencies
  automatically.
- Keep all edits in browser memory only.

The existing `Editor` component and every Monaco-backed article example remain
unchanged. Sharing playground URLs, private npm packages, multi-file editing,
and replacing the old unused `sandbox.astro` experiment are outside this scope.

## Page structure

The page is a normal Starlight document at `docs/src/content/docs/playground.mdx`
with one client-loaded React island. The page title component identifies it as
`Playground`, and `docs/astro.config.mjs` links it next to the introduction.

On desktop, the island uses the approved layout:

- a persistent example list on the left;
- a toolbar with `Reset` and `Run` above the editor;
- the Sandpack code editor in the main column;
- the Sandpack console below the editor.

On narrow screens, the example list becomes a labelled native `select`. The
editor and console remain vertically stacked and must not introduce horizontal
page overflow. Every interactive control has a minimum 44-by-44-pixel target,
visible keyboard focus, an accessible name, and a selected or busy state that
does not rely on colour alone.

## Examples

Each example is a standalone `/index.ts` program with a short title and a
one-sentence purpose:

1. **Basic module** creates and calls one named module.
2. **Composition** derives a greeting from a clock module using `Live`.
3. **Replace a boundary** supplies a deterministic clock value at the root.
4. **Partial application** binds one dependency with `.provide()`.
5. **Lazy and cache** demonstrates demand-driven evaluation and per-run reuse.
6. **HKT transform** wraps a module result while preserving its literal name
   and callback result type, then logs the wrapped runtime value.

Outputs are deterministic. Every program imports only what it uses, compiles as
strict TypeScript, and visibly logs a result so the console is meaningful.

## Component architecture

The implementation is split by responsibility:

- `playground.tsx` owns the selected example, per-example drafts, responsive
  navigation, toolbar, dependency status, and sandbox lifecycle.
- `playground-examples.ts` contains the immutable example metadata and source.
- `playground-dependencies.ts` is a small pure helper that extracts and normalizes
  npm package specifiers.
- `playground.css` styles only the playground and uses the existing `--docs-*`
  tokens for surfaces, borders, focus, and theme compatibility.

Only the selected example has a mounted `SandpackProvider`. Changing examples
saves the current draft in parent React state and unmounts the provider before
mounting the next one. Returning to an example restores its draft, but its old
runtime and console are intentionally gone. This keeps at most one Sandpack
runtime alive.

The provider uses Sandpack's `vanilla-ts` template with `autorun: false` and
`autoReload: false`. The `Run` button and `Ctrl+Enter` or `Cmd+Enter` call
Sandpack's manual `runSandpack()` operation. Selecting an example does not
execute it automatically; the empty console prompts the reader to run it.

## Automatic npm dependencies

Code edits update the saved draft immediately and restart a one-second debounce
timer. When the code has not changed for one second, the dependency helper
parses its module specifiers without running the program.

The helper applies these rules:

- keep bare package imports such as `lodash`;
- normalize `lodash/fp` to `lodash`;
- normalize `@scope/package/subpath` to `@scope/package`;
- support static imports, re-exports with `from`, and dynamic imports whose
  specifier is a string or no-substitution template literal;
- ignore relative paths, absolute paths, URLs, data URLs, and `node:` imports;
- pin `@favy/di` to `3.0.0` and assign `latest` to other detected packages.

An incomplete or syntactically invalid dependency-bearing import leaves the
last valid dependency set intact and shows a neutral waiting state rather than
a runtime error. A valid changed dependency set remounts only the active
provider with the new Sandpack configuration; because autorun is disabled,
this does not execute the program.

Computed dynamic imports do not declare an installable dependency. Sandpack
reports their syntax or runtime errors after `Run`, like the rest of the
program.

Pressing `Run` while the debounce is pending cancels the timer, parses imports
immediately, applies any dependency change, waits for the replacement provider
to become ready, and then performs exactly one run. This prevents a fast click
from producing a false missing-package error.

## States and errors

The toolbar exposes short status text for `Ready`, `Checking imports`,
`Preparing dependencies`, `Running`, and `Failed`. `Run` is disabled only while
the current run or a required provider replacement is in progress. `Reset`
restores the selected example source, re-detects its dependencies, and clears
the console by replacing the active provider.

Package resolution, bundling, syntax, and runtime failures appear in the
console or adjacent status region without breaking the surrounding docs page.
The last valid dependency set is retained after an incomplete edit. Switching
examples always disposes the failed or successful active sandbox.

User code executes in Sandpack's isolated preview iframe, not in the docs page
context. The first version supports public npm packages only and does not store
credentials or source remotely through application code.

## Documentation integration

- Add `Playground` to the `Getting started` sidebar group.
- Give the page the same title and content-width treatment as other docs pages,
  while allowing the playground island enough width for the approved sidebar
  layout.
- Add the canonical `https://di.favy.dev/playground/` link to `llms.txt` as an
  optional interactive resource.
- Do not add the playground component to existing article pages and do not
  modify their Monaco loading, typings, hover, or formatting behavior.

## Verification

1. Unit-test dependency extraction for unscoped, scoped, subpath, re-export,
   dynamic, relative, URL, `node:`, incomplete, and invalid inputs.
2. Test the one-second debounce with controlled timers and verify that a manual
   run flushes a pending dependency scan before execution.
3. Test example switching, draft restoration, reset behavior, and the invariant
   that only one provider is mounted.
4. Extend the Playwright documentation smoke test to verify desktop and mobile
   navigation, keyboard operation, minimum target sizes, absence of page
   overflow, a successful example run, console output, and recovery from an
   invalid import.
5. Compile all six original examples as standalone strict TypeScript programs.
6. Run `npx nx run docs:check --skip-nx-cache` and
   `npx nx run docs:build --skip-nx-cache`.

The existing clean-worktree Monaco hover smoke failure remains a documented
baseline issue and is not addressed by this feature.
