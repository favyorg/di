# Clean HKT Output Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant type-assertion variables from the two live HKT output examples without losing hover information or executable behavior.

**Architecture:** Keep the inferred `output` value as the single named intermediate, then read its `name` and `value` properties directly where they are used. Existing strict-compilation, runtime, build, and browser checks verify the examples as executable artifacts; no source-text change-detector test is added.

**Tech Stack:** TypeScript, Astro MDX, Jest, Playwright

## Global Constraints

- Keep `const output = Greeting()` in both examples for editor hover inspection.
- Do not modify historical implementation plans.
- Preserve the visible output `Greeting: hello`.

---

### Task 1: Simplify the live HKT examples

**Files:**
- Modify: `docs/src/components/playground/playground-examples.ts:112`
- Modify: `docs/src/content/docs/module/transform-output.mdx:122`
- Test: `docs/test/playground-examples.spec.ts`
- Test: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Consumes: the existing `BoxModule`, `Greeting`, and inferred `output` value in each example.
- Produces: the unchanged console line `Greeting: hello` and an `output` identifier whose full inferred HKT result remains hoverable.

- [ ] **Step 1: Confirm the existing executable coverage**

Run:

```bash
npx jest docs/test/playground-examples.spec.ts --runInBand
```

Expected: PASS, proving the playground example is strict-valid before the readability-only edit. No new source assertion is added because it would test wording rather than behavior.

- [ ] **Step 2: Simplify the playground example**

Replace the typed aliases with direct property use:

```ts
const Greeting = BoxModule()('Greeting', () => 'hello');
const output = Greeting();

console.log(`${output.name}: ${output.value}`); // Greeting: hello
```

- [ ] **Step 3: Simplify the documentation example**

Use the same teaching pattern in the MDX code sample:

```ts
const Greeting = BoxModule()('Greeting', () => 'hello');
const output = Greeting();

console.log(`${output.name}: ${output.value}`); // "Greeting: hello"
```

- [ ] **Step 4: Verify executable behavior and rendering**

Run:

```bash
npx jest docs/test/playground-examples.spec.ts --runInBand
npx nx test docs --skip-nx-cache --runInBand
npx nx run docs:build --skip-nx-cache
DOCS_URL=http://127.0.0.1:4323 PLAYGROUND_ONLY=1 node docs/scripts/docs-pages-smoke.mjs
```

Expected: the focused test, all docs tests, production build, and playground browser contract pass; the browser output still contains `Greeting: hello`.

- [ ] **Step 5: Commit and push**

Before both commit and push, check the complete branch diff for new or modified image files and optimize any found images. Then stage only the spec, plan, two live examples, and any directly necessary test updates; never stage `.superpowers/`.

```bash
git add docs/superpowers/specs/2026-08-08-clean-example-output-design.md \
  docs/superpowers/plans/2026-08-08-clean-example-output.md \
  docs/src/components/playground/playground-examples.ts \
  docs/src/content/docs/module/transform-output.mdx
git commit -m "docs: simplify HKT output examples"
git push origin readme-llms-v3
```
