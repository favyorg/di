# Documentation Pages Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every non-home documentation page with the v3 visual system, improve API and Testing scanability, and preserve all routes, anchors, content, and Monaco behavior.

**Architecture:** Keep Starlight's page shell and navigation behavior. Add two focused global CSS files, a Starlight `PageTitle` override, and semantic MDX structure for API and Testing. Verify user-visible behavior with one tracked Playwright contract and keep `editor.tsx` untouched.

**Tech Stack:** Astro 4, Starlight 0.28, MDX, Tailwind CSS 3, Monaco Editor, Playwright.

## Global Constraints

- Preserve every existing route and public symbol anchor.
- Preserve all technical explanations, declarations, and runnable examples.
- Do not modify or overwrite the existing uncommitted changes in `docs/src/components/editor.tsx`.
- Keep Monaco editable with TypeScript diagnostics and hover information.
- Add no new client-side JavaScript and no dependencies.
- Keep the 45rem article column, light/dark themes, and homepage asset isolation.
- Use 16px mobile gutters, at least 44px interactive targets, and no document-level horizontal overflow.
- Keep `/reference/api/` as one route.

---

### Task 1: Add the docs-page contract and shared page chrome

**Files:**
- Create: `docs/scripts/docs-pages-smoke.mjs`
- Create: `docs/src/components/docs-page-title.astro`
- Create: `docs/src/styles/docs-shell.css`
- Modify: `docs/astro.config.mjs`
- Modify: `docs/src/tailwind.css`

**Interfaces:**
- Consumes: Starlight `Props` from `@astrojs/starlight/props` and frontmatter `title`/`description`.
- Produces: `.docs-page-title`, `.docs-page-label`, and `.docs-page-description`; shared `--docs-*` color, radius, and shadow tokens.

- [ ] **Step 1: Write the failing browser contract**

Create `docs/scripts/docs-pages-smoke.mjs` with:

```js
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.DOCS_URL ?? 'http://127.0.0.1:4321';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'dark',
});
const page = await context.newPage();

try {
  await page.goto(`${origin}/guides/introduction/`, {
    waitUntil: 'domcontentloaded',
  });

  assert.equal(
    (await page.locator('.docs-page-label').textContent())?.trim(),
    'Guide',
  );
  assert.equal(
    (await page.locator('.docs-page-title h1').textContent())?.trim(),
    'Introduction',
  );
  assert.equal(
    (await page.locator('.docs-page-description').textContent())?.trim(),
    'Build and run an explicit, type-safe dependency graph with @favy/di.',
  );
  assert.equal(await page.locator('h1#_top').count(), 1);

  const typography = await page.evaluate(() => {
    const content = document.querySelector('.sl-markdown-content');
    const paragraph = content?.querySelector('p');
    const heading = content?.querySelector('h2');
    if (!content || !paragraph || !heading) return null;
    const paragraphStyle = getComputedStyle(paragraph);
    const headingStyle = getComputedStyle(heading);
    return {
      contentWidth: content.getBoundingClientRect().width,
      lineHeight: Number.parseFloat(paragraphStyle.lineHeight),
      fontSize: Number.parseFloat(paragraphStyle.fontSize),
      headingMargin: Number.parseFloat(headingStyle.marginTop),
    };
  });

  assert.ok(typography);
  assert.ok(typography.contentWidth <= 720);
  assert.ok(typography.lineHeight / typography.fontSize >= 1.65);
  assert.ok(typography.headingMargin >= 40);

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('.docs-page-title').count(), 0);
  assert.equal(await page.locator('.home-workbench').count(), 1);
} finally {
  await browser.close();
}

console.log('Documentation page contract passed');
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
node docs/scripts/docs-pages-smoke.mjs
```

Expected: FAIL because `.docs-page-label` does not exist.

- [ ] **Step 3: Remove the destructive Markdown reset**

Delete only the final `.sl-markdown-content ... { margin-top: 0; }` rule from
`docs/src/tailwind.css`. Keep the Tailwind directives and existing base layer.

- [ ] **Step 4: Add the PageTitle override**

Create `docs/src/components/docs-page-title.astro`:

```astro
---
import type { Props } from '@astrojs/starlight/props';

const { entry } = Astro.props;
const slug = entry.slug;
const label = slug.startsWith('guides/')
  ? 'Guide'
  : slug.startsWith('reference/')
    ? 'Reference'
    : slug.includes('transform-')
      ? 'Advanced'
      : 'Core concept';
---

<header class="docs-page-title">
  <p class="docs-page-label">{label}</p>
  <h1 id="_top">{entry.data.title}</h1>
  {
    entry.data.description && (
      <p class="docs-page-description">{entry.data.description}</p>
    )
  }
</header>
```

Give the component scoped styles for a 0.75rem uppercase label, a
`clamp(2.6rem, 7vw, 3.25rem)` H1, and a `max-width: 42rem` lead using the
shared tokens.

- [ ] **Step 5: Add shell tokens and navigation styling**

Create `docs/src/styles/docs-shell.css`. Scope page-only rules with
`html:not([data-has-hero])`. Define:

```css
:root {
  --docs-accent: #7766e9;
  --docs-accent-soft: color-mix(in srgb, #7766e9 15%, transparent);
  --docs-secondary: #3f9da8;
  --docs-surface: #111827;
  --docs-surface-raised: #1c2738;
  --docs-border: rgba(151, 163, 190, 0.2);
  --docs-muted: #a6aec2;
  --docs-radius-md: 0.8rem;
  --docs-radius-lg: 1.15rem;
  --docs-shadow: 0 18px 45px rgba(2, 6, 23, 0.12);
}

:root[data-theme='light'] {
  --docs-surface: #f8f9fc;
  --docs-surface-raised: #ffffff;
  --docs-border: rgba(51, 65, 85, 0.16);
  --docs-muted: #596276;
  --docs-shadow: 0 18px 45px rgba(30, 41, 59, 0.08);
}

html:not([data-has-hero]) {
  --sl-content-width: 45rem;
}
```

Style the header, sidebar active item, TOC current item, mobile TOC, focus
rings, and pagination using Starlight's existing selectors. Do not change
their display, disclosure, sticky, or scrolling behavior.

- [ ] **Step 6: Register CSS and the component override**

In `docs/astro.config.mjs`, change the Starlight configuration to include:

```js
components: {
  PageTitle: './src/components/docs-page-title.astro',
},
customCss: [
  '/src/tailwind.css',
  '/src/styles/docs-shell.css',
  '/src/styles/docs-content.css',
],
```

The content stylesheet is created in Task 2; create an empty
`docs/src/styles/docs-content.css` in this step so Astro can resolve it.

- [ ] **Step 7: Run GREEN checks**

Run:

```bash
node docs/scripts/docs-pages-smoke.mjs
npx nx run docs:check --skip-nx-cache
git diff --check
```

Expected: browser contract passes; Astro reports 0 errors, warnings, and
hints; `git diff --check` is silent.

- [ ] **Step 8: Commit**

```bash
git add docs/scripts/docs-pages-smoke.mjs docs/src/components/docs-page-title.astro docs/src/styles/docs-shell.css docs/src/styles/docs-content.css docs/src/tailwind.css docs/astro.config.mjs
git commit -m "feat(docs): add documentation page visual system"
```

### Task 2: Style Markdown, code, and Monaco surfaces

**Files:**
- Modify: `docs/src/styles/docs-content.css`
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 `--docs-*` tokens and `astro-island[component-export='Editor']`.
- Produces: shared article rhythm, `.api-index`, `.api-declaration`, and `.example-contract` primitives used by Tasks 3 and 4.

- [ ] **Step 1: Extend the contract and verify RED**

Before navigating to the homepage in `docs-pages-smoke.mjs`, add:

```js
await page.waitForSelector('.monaco-editor', { timeout: 15_000 });

const editorSurface = await page
  .locator(\"astro-island[component-export='Editor']\")
  .first()
  .evaluate((element) => {
    const style = getComputedStyle(element);
    const cue = getComputedStyle(element, '::before').content;
    return {
      borderWidth: Number.parseFloat(style.borderTopWidth),
      radius: Number.parseFloat(style.borderTopLeftRadius),
      cue,
    };
  });

assert.ok(editorSurface.borderWidth >= 1);
assert.ok(editorSurface.radius >= 12);
assert.match(editorSurface.cue, /TypeScript/);

await page.setViewportSize({ width: 320, height: 900 });
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
assert.match(
  await page
    .locator(\"astro-island[component-export='Editor']\")
    .first()
    .evaluate((element) => getComputedStyle(element, '::before').content),
  /scroll|swipe/i,
);
```

Run `node docs/scripts/docs-pages-smoke.mjs`.

Expected: FAIL because the editor island has no border or cue.

- [ ] **Step 2: Implement the content system**

In `docs/src/styles/docs-content.css`:

- scope ordinary article styles with
  `html:not([data-has-hero]) .sl-markdown-content`;
- set paragraphs and list items to `1rem / 1.75`;
- restore `1rem` block spacing and at least `3rem` before H2;
- give H2 a `clamp(1.65rem, 4vw, 2rem)` size and subtle section divider;
- style inline code, tables, blockquotes, details, and fenced code with the
  Task 1 tokens;
- make every direct Editor island `display: block`, `overflow: hidden`, with
  border, radius, background, shadow, and at least `2rem` vertical margin;
- use the island `::before` as a decorative `TypeScript example · editable`
  bar and change it to `TypeScript · swipe to inspect →` below 45rem;
- style Monaco's outer background/border only; do not target token classes,
  hover widgets, view lines, or worker behavior;
- style `.api-index`, `.api-declaration`, and `.example-contract` as semantic
  content primitives without JavaScript.

- [ ] **Step 3: Verify Monaco hover and fallback**

Extend the smoke script:

```js
await page.setViewportSize({ width: 1440, height: 1000 });
const modulePosition = await page
  .locator('.monaco-editor .view-line')
  .first()
  .evaluate((line) => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = node.textContent?.indexOf('Module') ?? -1;
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 'Module'.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      node = walker.nextNode();
    }
    return null;
  });
assert.ok(modulePosition);
await page.mouse.move(modulePosition.x, modulePosition.y);
await page.locator('.monaco-hover:visible').waitFor({ timeout: 5_000 });

const noScript = await browser.newContext({
  javaScriptEnabled: false,
  viewport: { width: 390, height: 844 },
});
const noScriptPage = await noScript.newPage();
await noScriptPage.goto(`${origin}/guides/introduction/`, {
  waitUntil: 'domcontentloaded',
});
assert.ok(
  await noScriptPage
    .locator(\"astro-island[component-export='Editor'] pre[aria-label='TypeScript example']\")
    .count(),
);
await noScript.close();
```

- [ ] **Step 4: Run GREEN checks and commit**

```bash
node docs/scripts/docs-pages-smoke.mjs
npx nx run docs:check --skip-nx-cache
git diff --check
git add docs/src/styles/docs-content.css docs/scripts/docs-pages-smoke.mjs
git commit -m "feat(docs): style documentation content and examples"
```

### Task 3: Reorganize the API Reference

**Files:**
- Modify: `docs/src/content/docs/reference/api.mdx`
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Consumes: `.api-index` and `.api-declaration` from Task 2.
- Produces: `#common-api`, `#factory-configuration`, and `#advanced-types`
  groups while preserving all existing symbol IDs.

- [ ] **Step 1: Add API assertions and verify RED**

Add a `/reference/api/` section to the smoke script:

```js
await page.goto(`${origin}/reference/api/`, {
  waitUntil: 'domcontentloaded',
});

for (const id of [
  'module',
  'makemodule',
  'makeoptionsd-m-p-i-o',
  'defaultmodulefactory',
  'tmodulek-d-r-c--d',
  'livet',
  'modulelive',
  'withmodulename',
  'transforminputd-p',
  'transformoutputi-d-o',
  'hkt',
  'kindh-name-result-deps-meta-meta2',
]) {
  assert.equal(await page.locator(`#${id}`).count(), 1, `Missing #${id}`);
}

assert.equal(await page.locator('.api-index').count(), 1);
assert.equal(await page.locator('h2#common-api').count(), 1);
assert.equal(await page.locator('h2#factory-configuration').count(), 1);
assert.equal(await page.locator('h2#advanced-types').count(), 1);
assert.equal(await page.locator('details.api-declaration').count(), 2);
```

Run the script and expect failure because `.api-index` is missing.

- [ ] **Step 2: Add the quick-reference index**

After the package export block, add:

```mdx
<nav class="api-index" aria-label="API symbols">
  <strong>Common API</strong>
  <a href="#module">Module</a>
  <a href="#livet">Live</a>
  <a href="#modulelive">ModuleLive</a>

  <strong>Factory configuration</strong>
  <a href="#makemodule">makeModule</a>
  <a href="#makeoptionsd-m-p-i-o">MakeOptions</a>
  <a href="#defaultmodulefactory">DefaultModuleFactory</a>
  <a href="#withmodulename">withModuleName</a>
  <a href="#transforminputd-p">transformInput</a>
  <a href="#transformoutputi-d-o">transformOutput</a>

  <strong>Advanced types</strong>
  <a href="#tmodulek-d-r-c--d">TModule</a>
  <a href="#hkt">HKT</a>
  <a href="#kindh-name-result-deps-meta-meta2">Kind</a>
</nav>
```

- [ ] **Step 3: Group symbols without changing their IDs**

Reorder complete symbol sections and use:

```md
## Common API
### `Module`
### `Live<T>`
### `ModuleLive`

## Factory configuration
### `makeModule`
### `MakeOptions<D, M, P, I, O>`
### `DefaultModuleFactory`
### `withModuleName`
### `transformInput<D, P>`
### `transformOutput<I, D, O>`

## Advanced types
### `TModule<K, D, R, C = D>`
### `HKT`
### `Kind<H, NAME, RESULT, DEPS, META, META2>`
```

Move each complete section as one block. Do not edit declarations, prose,
tables, examples, or the `Cache modes` subsection. Markdown-generated symbol
IDs remain unchanged even though symbol headings become H3.

- [ ] **Step 4: Collapse only the two full declarations**

Wrap the current long declaration code blocks for `makeModule` and `TModule`
with:

````mdx
<details class="api-declaration">
  <summary>Full declaration</summary>

```ts
// existing declaration, unchanged
```

</details>
````

Keep the descriptive prose, option table, bullets, and editors outside the
details.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
node docs/scripts/docs-pages-smoke.mjs
npx nx run docs:check --skip-nx-cache
git diff --check
git add docs/src/content/docs/reference/api.mdx docs/scripts/docs-pages-smoke.mjs
git commit -m "docs: make API reference easier to scan"
```

### Task 4: Add semantic summaries to Testing

**Files:**
- Modify: `docs/src/content/docs/guides/testing.mdx`
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Consumes: `.example-contract` styles from Task 2.
- Produces: five semantic test-boundary summaries; examples and testing claims
  remain unchanged.

- [ ] **Step 1: Add Testing assertions and verify RED**

Add:

```js
await page.goto(`${origin}/guides/testing/`, {
  waitUntil: 'domcontentloaded',
});
assert.equal(await page.locator('dl.example-contract').count(), 5);
assert.deepEqual(
  await page.locator('dl.example-contract dt').allTextContents(),
  Array(5).fill(['Boundary', 'Kept real', 'Replaced', 'Proves']).flat(),
);
```

Expected: FAIL because no `.example-contract` exists.

- [ ] **Step 2: Insert the five summaries**

Before each Editor, add a `<dl class="example-contract">` with these literal
values:

1. Unit test:
   Boundary `UserApi`; Kept real `UserApi`; Replaced `HttpClient`; Proves
   `Returned user and requested URL`.
2. Integration test:
   Boundary `Database`; Kept real `UserRepository → UserService`; Replaced
   `Database`; Proves `Service output and forwarded user ID`.
3. Fixture:
   Boundary `Mailer`; Kept real `WelcomeMessage`; Replaced
   `Mailer via .provide()`; Proves `Message payload and isolated fixture state`.
4. Cache:
   Boundary `CachedModule factory`; Kept real `Counter`; Replaced
   `Nothing; the owned cache is reset`; Proves
   `One initialization per test`.
5. Lazy access:
   Boundary `ExpensiveFeature access`; Kept real `App and ExpensiveFeature`;
   Replaced `Nothing; initialization is observed`; Proves
   `The disabled branch stays lazy and the enabled branch resolves once`.

Use exactly four `<dt>`/`<dd>` pairs in every summary and no client component.

- [ ] **Step 3: Run GREEN checks and commit**

```bash
node docs/scripts/docs-pages-smoke.mjs
npx nx run docs:check --skip-nx-cache
git diff --check
git add docs/src/content/docs/guides/testing.mdx docs/scripts/docs-pages-smoke.mjs
git commit -m "docs: clarify testing example boundaries"
```

### Task 5: Production verification and review

**Files:**
- Modify only if verification reveals an in-scope defect.
- Do not modify: `docs/src/components/editor.tsx`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reviewed production build with visual evidence.

- [ ] **Step 1: Run full static verification**

```bash
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
node docs/scripts/docs-pages-smoke.mjs
git diff --check
```

Expected: Astro check has 0 errors/warnings/hints, build completes all current
routes, browser contract passes, and diff check is silent.

- [ ] **Step 2: Run the contract against production preview**

Start or reuse Astro preview, then run:

```bash
DOCS_URL=http://127.0.0.1:4323 node docs/scripts/docs-pages-smoke.mjs
```

Expected: PASS against `docs/dist`.

- [ ] **Step 3: Capture and inspect representative pages**

Capture full-page screenshots in dark and light themes at 1440px for:

- `/guides/introduction/`
- `/module/module/`
- `/guides/testing/`
- `/reference/api/`

Capture Introduction and API at 390px, then inspect 320px for document
overflow. Compare the homepage at 1440px and 390px with the approved v3
screenshots.

- [ ] **Step 4: Verify navigation and accessibility**

In the browser:

- follow every quick-index API link and confirm the URL hash targets the
  corresponding symbol;
- keyboard-focus sidebar, TOC, details, code/editor, and pagination;
- confirm active states are visible in both themes;
- disable JavaScript and confirm all editor fallbacks remain readable;
- hover `Module` in a Monaco editor and confirm type information appears.

- [ ] **Step 5: Request independent reviews**

Request:

1. visual/responsive/accessibility review;
2. maintainability and scope-isolation review;
3. API/Testing content-preservation review.

Fix every Critical or Important finding, rerun the affected checks, and amend
the relevant implementation commit.

- [ ] **Step 6: Confirm repository scope**

```bash
git status --short
git diff -- docs/src/components/editor.tsx
git log --oneline -8
```

Expected: `editor.tsx` still contains only the user's pre-existing diff;
implementation commits contain only planned docs-page files.
