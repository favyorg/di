# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock Starlight splash page with a lightweight, responsive developer-workbench homepage that explains `@favy/di` through real code and clear documentation paths.

**Architecture:** Keep Starlight's shared shell and `template: splash`. Render one local `Home.astro` component from `index.mdx`; keep all homepage markup, scoped styles, and copy enhancement inside that component so no other docs route changes.

**Tech Stack:** Astro 4, Starlight 0.28, scoped CSS, static HTML code markup, inline SVG, browser smoke validation with the existing Playwright dependency.

## Global Constraints

- Do not redesign the shared Starlight header, sidebar, or documentation pages.
- Do not change the library API or examples outside the homepage.
- Do not repair the existing Starlight theme integration as part of this work.
- Do not load Monaco or another full editor on the homepage.
- Do not add an image asset, animation library, UI dependency, or permanent test dependency.
- Preserve links to Introduction, Module, Caching, Lazy, Partial Application, Testing, Best Practices, Transform Input, Transform Output, API Reference, and GitHub.
- Keep the page usable from a 320 px viewport upward and avoid page-level horizontal overflow.

---

### Task 1: Define the homepage browser contract

**Files:**
- Create, test-only and uncommitted: `.superpowers/homepage-redesign-smoke.mjs`

**Interfaces:**
- Consumes: the docs dev server at `http://127.0.0.1:4321/`
- Produces: a repeatable browser assertion script for the new homepage contract

- [ ] **Step 1: Write the failing browser smoke test**

Create `.superpowers/homepage-redesign-smoke.mjs` with:

```js
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4321';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

try {
  await page.goto(origin, { waitUntil: 'networkidle' });

  assert.equal(
    (await page.locator('.home .hero-title').textContent())?.trim(),
    'Dependency graphs, just typed functions.',
  );
  assert.equal(await page.locator('.home-workbench').count(), 1);
  assert.equal(await page.locator('.monaco-editor').count(), 0);
  assert.equal(await page.locator('main img').count(), 0);

  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  assert.equal(await skipLink.getAttribute('href'), '#_top');
  const skipPosition = await page.evaluate(() => ({
    target: document.querySelector('#_top')?.getBoundingClientRect().top,
    content: document
      .querySelector('.home-workbench')
      ?.getBoundingClientRect().top,
  }));
  assert.ok(
    skipPosition.target !== undefined &&
      skipPosition.content !== undefined &&
      Math.abs(skipPosition.target - skipPosition.content) <= 2,
    'Skip-link target is not aligned with visible homepage content',
  );

  for (const path of [
    '/guides/introduction/',
    '/module/module/',
    '/module/cache/',
    '/module/lazy/',
    '/module/partial/',
    '/guides/testing/',
    '/guides/best-practices/',
    '/module/transform-input/',
    '/module/transform-output/',
    '/reference/api/',
    'https://github.com/favyorg/di',
  ]) {
    assert.ok(
      await page.locator(`main a[href="${path}"]`).count(),
      `Missing homepage link: ${path}`,
    );
  }

  const installCopy = page.locator(
    '[data-copy-value="npm install @favy/di"]',
  );
  assert.equal(await installCopy.getAttribute('aria-label'), 'Copy install command');
  await installCopy.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Copy install command"]')?.dataset
        .copyState === 'copied',
  );

  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    'Homepage has horizontal overflow at 320 px',
  );
} finally {
  await browser.close();
}

console.log('Homepage browser contract passed');
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
node .superpowers/homepage-redesign-smoke.mjs
```

Expected: failure because the current heading is
`Dependency injection as typed functions` and `.home-workbench` does not exist.

---

### Task 2: Build the isolated homepage component

**Files:**
- Create: `docs/src/components/home.astro`
- Modify: `docs/src/content/docs/index.mdx`

**Interfaces:**
- Consumes: Starlight's `--sl-*` theme tokens and existing documentation routes
- Produces: `Home`, an Astro component rendered once by the homepage MDX entry

- [ ] **Step 1: Replace the default splash body with `Home`**

Keep only the page metadata and component render in
`docs/src/content/docs/index.mdx`:

```mdx
---
title: Dependency injection as typed functions
description: Build explicit, composable TypeScript dependency graphs without decorators or container configuration.
template: splash
---

import Home from '../../components/home.astro';

<Home />
```

- [ ] **Step 2: Add the hero and static code proof**

Create `docs/src/components/home.astro` with a `<div class="home">` inside
Starlight's existing page `<main>`, containing `.home-workbench`. The hero copy
must use:

```text
v3 · TypeScript-first DI
Dependency graphs, just typed functions.
Explicit dependencies. Replaceable boundaries. No decorators, reflection, or container ceremony.
```

Add `Get started` and `API reference` links, the exact install command
`npm install @favy/di`, a static TypeScript snippet using `Module` and
`Live<typeof Clock>`, and an inline graph labeled `Clock → Greeting → message`.
Code is ordinary `<pre><code>` markup with span-based syntax colors; do not
mount Monaco.

- [ ] **Step 3: Add proof, explanation, capability, path, and closing sections**

Add:

- four proof items: `0 decorators`, `Typed end to end`, `Lazy by default`,
  `Replaceable boundaries`;
- a three-step explanation of define, compose, and run;
- six linked capability cards for graph typing, caching, lazy resolution,
  partial application, testing, and transforms;
- four learning-path cards for Start, Build, Test, and Extend;
- closing links to Introduction and GitHub.

Use the exact routes listed in Global Constraints. Headings and card copy stay
short enough that each section remains scannable.

- [ ] **Step 4: Add scoped responsive styles**

Keep styles in the component's `<style>` block and:

- contain the hero at a maximum width while allowing its dark surface in both
  themes;
- use a two-column hero above 900 px and one column below it;
- collapse proof and card grids at 720 px and 480 px;
- add `min-width: 0` to grid children and `overflow-x: auto` only to code;
- use Starlight `--sl-*` tokens outside the hero;
- include `:focus-visible` treatments and 44 px control heights;
- keep transitions short and disable them under `prefers-reduced-motion`.

- [ ] **Step 5: Add progressive copy behavior**

Use buttons with `data-copy`, `data-copy-value`, and a visible label. Add one
small component-local script that:

1. listens for clicks on `[data-copy]`;
2. calls `navigator.clipboard.writeText(button.dataset.copyValue)`;
3. sets `data-copy-state="copied"` and label text `Copied`;
4. restores the original label and state after 1.8 seconds;
5. leaves the page and navigation fully usable when JavaScript is unavailable.

- [ ] **Step 6: Format and verify GREEN**

Run:

```bash
npx prettier --write docs/src/components/home.astro docs/src/content/docs/index.mdx
node .superpowers/homepage-redesign-smoke.mjs
```

Expected: Prettier succeeds and the browser contract prints
`Homepage browser contract passed`.

- [ ] **Step 7: Commit the implementation**

Stage only the homepage files:

```bash
git add docs/src/components/home.astro docs/src/content/docs/index.mdx
git commit -m "feat(docs): redesign homepage"
```

---

### Task 3: Validate the finished homepage

**Files:**
- Verify: `docs/src/components/home.astro`
- Verify: `docs/src/content/docs/index.mdx`

**Interfaces:**
- Consumes: the completed homepage and docs build
- Produces: type-check, build, interaction, accessibility, and visual evidence

- [ ] **Step 1: Run repository checks**

Run:

```bash
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
node .superpowers/homepage-redesign-smoke.mjs
git diff --check HEAD^..HEAD
```

Expected: all commands exit with status 0.

- [ ] **Step 2: Inspect desktop themes**

Open the homepage at 1440 × 1000 in light mode and dark mode. Confirm:

- the workbench is visually dominant but does not collide with the Starlight
  header;
- the code and graph are legible;
- the content below follows the current Starlight theme;
- focus outlines and link contrast remain clear;
- no console errors occur.

- [ ] **Step 3: Inspect mobile layouts**

Open the homepage at 390 × 844 and 320 × 900. Confirm:

- copy precedes code;
- actions wrap without clipping;
- code scrolls inside its panel;
- proof points and cards form one readable column;
- the document has no page-level horizontal overflow.

- [ ] **Step 4: Review scope**

Run:

```bash
git status --short
git show --stat --oneline HEAD
```

Confirm the implementation commit contains only
`docs/src/components/home.astro` and `docs/src/content/docs/index.mdx`, while
the pre-existing `docs/src/components/editor.tsx` change and unrelated
untracked files remain untouched.
