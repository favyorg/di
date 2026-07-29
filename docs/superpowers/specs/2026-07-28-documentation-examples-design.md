# Documentation Examples Quality Design

## Context

The documentation currently contains 40 interactive TypeScript examples across
11 rendered pages. A browser audit confirmed that every editor mounts, no
server-rendered fallback remains visible, and Monaco reports no TypeScript
errors. The examples are technically sound overall, but several do not prove
the claim made by their surrounding section.

The current examples have a median length of 20 lines. Ten are longer than 25
lines and eight are longer than 30 lines. Length alone is not a defect: the
advanced HKT, transitive dependency, and standalone testing examples need more
context. The redesign therefore targets weak examples instead of normalizing
all snippets mechanically.

## Goals

- Make every changed example demonstrate exactly one stated behavior.
- End each behavioral example with an observable value or assertion.
- Keep ordinary examples near 10–20 lines.
- Keep standalone tests and HKT examples at or below roughly 35 lines when
  doing so does not hide required context.
- Preserve standalone copy/paste usefulness.
- Remove misleading terminology and Monaco hint diagnostics.
- Keep every example aligned with the current `@favy/di` runtime and types.

## Non-goals

- Do not change the library API or implementation.
- Do not rewrite examples that already demonstrate their claim clearly.
- Do not force every example into an identical domain model.
- Do not add a new documentation testing framework or dependency.
- Do not shorten advanced examples by moving required code into hidden files.

## Example Structure

Each changed behavioral example follows this order:

1. Define the smallest dependency contract needed for the claim.
2. Create the module or factory configuration being demonstrated.
3. Perform the action that distinguishes the behavior from nearby alternatives.
4. Show the result with `expect(...)` or a `console.log(...)` comment.

Setup that does not affect the demonstrated behavior is removed. A line budget
is a default, not a reason to make an example implicit or non-standalone.

## Planned Replacements

### Testing: integration boundary

**File:** `docs/src/content/docs/guides/testing.mdx`

Keep `UserRepository` and `UserService` real. Replace the database fake with a
fake that:

- appends every received ID to `requestedIds`;
- derives its returned user name from that ID.

The test will assert both:

- `getDisplayName(7)` returns `"User 7"`;
- `requestedIds` equals `[7]`.

This makes the example fail if the repository bypasses the database or forwards
the wrong argument. The rewritten snippet should remain standalone and stay
within approximately 35 lines.

### Testing: factory-wide cache reset

**File:** `docs/src/content/docs/guides/testing.mdx`

Retain `beforeEach`, but use two test cases. Each test will call the same
factory-wide cached `Counter` twice and assert:

- both calls return `1`;
- `initializationCount` is `1`.

`beforeEach` will call `CachedModule.flushCache()` and reset
`initializationCount` to `0`. If `flushCache()` is removed or broken, the second
test receives the previous cached value without incrementing the reset counter,
so its `initializationCount` assertion fails. This proves both reuse within a
test and isolation between tests.

### Testing: lazy terminology

**File:** `docs/src/content/docs/guides/testing.mdx`

Replace “optional dependency” with “conditionally used dependency” or “lazy
provider.” `ExpensiveFeature` remains required by the type contract; only its
runtime resolution is conditional.

### Best practices: explicit boundaries

**File:** `docs/src/content/docs/guides/best-practices.mdx`

Replace the current 43-line example with two focused examples:

1. **Replaceable port:** a small module depends on a `Clock` interface and is
   called with a fake clock. This demonstrates when an interface is the useful
   boundary.
2. **Concrete graph:** a two-module `Config` → `ApiUrl` graph uses
   `Live<typeof Config>`. This demonstrates when the concrete module belongs in
   the graph contract.

Each example should stay near 20 lines and its adjacent prose must state why its
boundary style was selected.

### Best practices: run-scoped caching

**File:** `docs/src/content/docs/guides/best-practices.mdx`

Replace the current request-context example with one that has a
`contextCreationCount`. The root module must access the same provider property
twice through the dependency object rather than destructuring it once.

The example will perform two root calls and show:

- both reads in the first root call return the same context value;
- both reads in the second root call return a new shared value;
- the provider was created exactly twice.

With `cache: 'none'`, the two reads within a root call would differ. The output
therefore demonstrates the behavior specific to `cache: 'run'`.

### Best practices: recoverable errors

**File:** `docs/src/content/docs/guides/best-practices.mdx`

Replace the catch-all conversion with an explicit `RepositoryUnavailable`
error. The module will:

- convert `RepositoryUnavailable` into the documented domain `Result`;
- rethrow unknown exceptions;
- be called with a small repository fake that throws the expected error;
- show the resulting recoverable value.

The example should stay within approximately 35 lines. This aligns the code
with the surrounding recommendation to recover only where recovery is known to
be valid and removes the unused-module Monaco hint.

### Best practices: instance-owned test state

**File:** `docs/src/content/docs/guides/best-practices.mdx`

Shorten the existing mock logger example to one logger method and one `logs`
array. Keep the state inside the object returned by `createMockLogger`, invoke
the consumer once, and show the recorded value. The full unit and integration
patterns remain on the Testing page.

### Transform output: inferred concrete result

**File:** `docs/src/content/docs/module/transform-output.mdx`

Keep the explicit assignment:

```ts
const message: string = box.value;
```

Change the following output line to log `message` instead of `box.value`. This
uses the compile-time assertion in the runtime demonstration and removes the
unused-variable Monaco hint.

### API reference: module cache example

**File:** `docs/src/content/docs/reference/api.mdx`

Change:

```ts
makeModule({ cache: 'module', lazy: true });
```

to:

```ts
makeModule({ cache: 'module' });
```

`lazy: true` is the default and does not contribute to the cache behavior being
demonstrated.

## Examples Kept Intact

- The homepage quick start and all Introduction examples.
- The core Module, Cache, Lazy, and simple Partial Application examples.
- The transitive `.provide()` example.
- Both transform-input and transform-output HKT examples.
- The direct-dependency unit test, except for mechanical line reduction if it
  can remain equally explicit.
- The `.provide()` fixture and lazy-access tests, except for mechanical line
  reduction and the terminology correction described above.
- API declaration snippets whose purpose is exact reference rather than
  tutorial brevity.

## Validation

After editing:

1. Run Prettier against every changed MDX/TSX file.
2. Run `npx nx run docs:check --skip-nx-cache`.
3. Run `npx nx run docs:build --skip-nx-cache`.
4. Open every documentation route that contains an editor.
5. Confirm every expected Monaco editor mounts and no fallback remains.
6. Collect Monaco markers and require zero error or warning diagnostics for all
   example models.
7. Confirm no page emits console errors or unhandled runtime errors.
8. Manually verify the changed examples show the output or assertion stated in
   their surrounding prose.

## Acceptance Criteria

- The integration test observes both the final result and database input.
- The cache-reset test fails if factory cache flushing is removed.
- The run-cache example visibly distinguishes `'run'` from `'none'`.
- The error example maps only its declared recoverable failure.
- No example describes a required dependency as optional.
- Changed ordinary examples target 10–20 lines; standalone tests and advanced
  examples target at most approximately 35 lines.
- Monaco reports no unused-variable hints in changed examples.
- Existing strong HKT and transitive dependency examples retain their full
  behavior.
- Documentation check, production build, and browser audit pass.
