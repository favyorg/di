# Standalone Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing interactive playground at `/playground/` in a focused standalone Astro shell instead of the Starlight documentation layout.

**Architecture:** A custom `src/pages/playground.astro` becomes the only route owner and mounts the existing React playground unchanged. A page-specific stylesheet owns the standalone shell and the small `--playground-*` token contract used by the component, while Starlight keeps only a direct navigation link to the route.

**Tech Stack:** Astro 4, Starlight 0.28, React 18, Sandpack, Monaco, Jest, Playwright.

## Global Constraints

- Keep the public URL `https://di.favy.dev/playground/` and the current deployment.
- Do not render the Starlight sidebar, TOC, article title, pagination, or footer on the playground route.
- Keep the existing examples, dependency loading, one-second import delay, runtime protocol, type hover, and warm Run behavior.
- Reuse the `starlight-theme` preference and set `data-theme` before first paint.
- Keep a direct Playground link in the documentation navigation.
- Use TypeScript inference for `FixedClock`; do not add `ReturnType`, `satisfies`, or an inline replacement object.
- Do not stage `.superpowers/` and do not add co-author trailers.

## File Map

- Create `docs/src/pages/playground.astro`: route metadata, standalone landmarks, theme bootstrap/control, and React island mount.
- Create `docs/src/styles/playground-page.css`: standalone reset, theme tokens, header, page layout, and focus styles.
- Delete `docs/src/content/docs/playground.mdx`: remove the competing Starlight content route.
- Modify `docs/astro.config.mjs`: make the sidebar item a direct `/playground/` link.
- Modify `docs/src/components/docs-page-title.astro`: remove the dead playground-label branch.
- Modify `docs/src/components/playground/playground.css`: consume standalone tokens, remove article-layout coupling, and provide readable light/dark fallback syntax colors.
- Modify `docs/src/components/playground/playground.tsx`: remove the obsolete Starlight `not-content` marker only.
- Modify `docs/src/components/playground/playground-examples.ts`: let TypeScript infer `FixedClock`.
- Modify `docs/test/playground-examples.spec.ts`: lock the inferred replacement example.
- Modify `docs/scripts/docs-pages-smoke.mjs`: lock route ownership, metadata, navigation, theming, accessibility, responsive layout, hover, and execution.

---

### Task 1: Infer the replacement clock type

**Files:**
- Modify: `docs/test/playground-examples.spec.ts`
- Modify: `docs/src/components/playground/playground-examples.ts`

**Interfaces:**
- Consumes: `playgroundExampleById.replace.source`
- Produces: the same runnable replacement example without an explicit `FixedClock` type annotation

- [ ] **Step 1: Write the failing inference test**

Import `playgroundExampleById` beside `playgroundExamples` and add:

```ts
it('uses inference for the replacement boundary', () => {
  const example = playgroundExampleById.replace;

  expect(example.source).toContain('const FixedClock = {');
  expect(example.source).not.toContain('ReturnType<typeof Clock>');
  expect(
    diagnosticsFor(example.id, example.source).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
  ).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-examples.spec.ts
```

Expected: FAIL because the source still contains `ReturnType<typeof Clock>`.

- [ ] **Step 3: Remove only the redundant annotation**

Change the example to:

```ts
const FixedClock = {
  now: () => '2000-01-01T00:00:00.000Z',
};
```

Keep the named boundary and `Timestamp({ Clock: FixedClock })` call.

- [ ] **Step 4: Run the focused test and the example suite**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand \
  --testPathPattern=playground-examples.spec.ts
```

Expected: PASS; all six examples remain strict-TypeScript clean.

- [ ] **Step 5: Commit the example change**

```bash
git add docs/test/playground-examples.spec.ts \
  docs/src/components/playground/playground-examples.ts
git commit -m "docs: simplify replacement playground example"
```

---

### Task 2: Replace the Starlight page with a standalone route

**Files:**
- Create: `docs/src/pages/playground.astro`
- Create: `docs/src/styles/playground-page.css`
- Delete: `docs/src/content/docs/playground.mdx`
- Modify: `docs/astro.config.mjs`
- Modify: `docs/src/components/docs-page-title.astro`
- Modify: `docs/src/components/playground/playground.css`
- Modify: `docs/src/components/playground/playground.tsx`
- Modify: `docs/scripts/docs-pages-smoke.mjs`

**Interfaces:**
- Consumes: `Playground(): JSX.Element`, browser storage key `starlight-theme`, and the public `/playground/` URL
- Produces: one standalone Astro route and the CSS token contract `--playground-accent`, `--playground-accent-soft`, `--playground-surface`, `--playground-surface-raised`, `--playground-border`, `--playground-muted`, `--playground-text`, `--playground-radius-md`, `--playground-radius-lg`, `--playground-shadow`, and `--playground-font-mono`

- [ ] **Step 1: Replace the old page assertions with a failing standalone-shell contract**

In `checkPlayground()`, navigate through the docs sidebar so both route discovery
and route ownership are covered:

```js
await page.goto(`${origin}/guides/introduction/`, {
  waitUntil: 'domcontentloaded',
});
await page.evaluate(() => localStorage.setItem('starlight-theme', 'light'));

const playgroundLink = page
  .locator('.sidebar-pane a[href="/playground/"]')
  .filter({ hasText: 'Playground' })
  .first();
assert.equal(await playgroundLink.count(), 1);
await playgroundLink.click();
await page.waitForURL(`${origin}/playground/`);

assert.equal(await page.title(), 'Playground | @favy/di');
assert.equal(
  await page.locator('meta[name="description"]').getAttribute('content'),
  'Edit and run focused @favy/di examples directly in the browser.',
);
assert.equal(
  await page.locator('link[rel="canonical"]').getAttribute('href'),
  'https://di.favy.dev/playground/',
);
assert.equal(
  await page.locator('link[rel~="icon"][href="/favicon.svg"]').count(),
  1,
);

for (const selector of [
  '.docs-page-title',
  '.sidebar-pane',
  'site-search',
  'starlight-menu-button',
  'starlight-toc',
  'mobile-starlight-toc',
  '.pagination-links',
]) {
  assert.equal(
    await page.locator(selector).count(),
    0,
    `Standalone playground unexpectedly rendered ${selector}`,
  );
}

const header = page.getByRole('banner');
assert.equal(await header.count(), 1);
assert.equal(
  await header.getByRole('link', { name: '@favy/di', exact: true }).getAttribute('href'),
  '/',
);
assert.equal(
  await header.getByRole('link', { name: 'Docs', exact: true }).getAttribute('href'),
  '/guides/introduction/',
);
assert.equal(
  await header.getByRole('link', { name: 'GitHub', exact: true }).getAttribute('href'),
  'https://github.com/favyorg/di',
);
assert.equal(await page.getByRole('heading', { level: 1, name: 'Playground' }).count(), 1);
assert.equal(
  await page.locator('main[aria-label="TypeScript playground"]').count(),
  1,
);
```

Keep the existing Monaco hover, Run, network, reset, keyboard, and mobile
assertions below this new shell contract.

- [ ] **Step 2: Run the focused browser contract and verify it fails on docs chrome**

Use the existing branch dev server at `http://127.0.0.1:4324`. If it is not
running, start it in a persistent terminal with:

```bash
npm --prefix docs run dev -- --host 127.0.0.1 --port 4324
```

Then run:

```bash
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4324 \
  node docs/scripts/docs-pages-smoke.mjs
```

Expected: FAIL because `/playground/` still renders `.docs-page-title` and the
Starlight sidebar.

- [ ] **Step 3: Create the standalone Astro document**

Create `docs/src/pages/playground.astro` with this structure and behavior:

```astro
---
import { Playground } from '../components/playground/playground';
import '../styles/playground-page.css';

const title = 'Playground | @favy/di';
const description =
  'Edit and run focused @favy/di examples directly in the browser.';
const canonical = new URL('/playground/', Astro.site);
---

<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script is:inline>
      (() => {
        const preferred = matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
        let theme = preferred;
        try {
          const stored = localStorage.getItem('starlight-theme');
          if (stored === 'light' || stored === 'dark') theme = stored;
        } catch {}
        document.documentElement.dataset.theme = theme;
      })();
    </script>
  </head>
  <body>
    <a class="playground-shell__skip" href="#playground-main">Skip to playground</a>
    <header class="playground-shell__header">
      <a class="playground-shell__brand" href="/">@favy/di</a>
      <h1>Playground</h1>
      <nav aria-label="Playground">
        <a href="/guides/introduction/">Docs</a>
        <a href="https://github.com/favyorg/di">GitHub</a>
        <button type="button" data-theme-toggle aria-label="Use dark theme">
          <span aria-hidden="true">◐</span>
        </button>
      </nav>
    </header>
    <main id="playground-main" aria-label="TypeScript playground">
      <Playground client:load />
    </main>
    <script>
      const themeButton = document.querySelector<HTMLButtonElement>(
        '[data-theme-toggle]',
      );
      const syncThemeButton = (): void => {
        if (!themeButton) return;
        const isDark = document.documentElement.dataset.theme === 'dark';
        themeButton.setAttribute('aria-pressed', String(isDark));
        themeButton.setAttribute(
          'aria-label',
          isDark ? 'Use light theme' : 'Use dark theme',
        );
      };
      themeButton?.addEventListener('click', () => {
        const next =
          document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('starlight-theme', next);
        } catch {}
        syncThemeButton();
      });
      syncThemeButton();
    </script>
  </body>
</html>
```

Keep the theme bootstrap in `<head>` and the control script after the button.

- [ ] **Step 4: Give the page an isolated visual contract**

Create `docs/src/styles/playground-page.css`. Define both themes directly; do
not import Starlight `Page`, Rapide, or article CSS:

```css
:root {
  color-scheme: dark;
  --playground-accent: #8b7cf6;
  --playground-accent-soft: color-mix(in srgb, #8b7cf6 17%, transparent);
  --playground-surface: #111827;
  --playground-surface-raised: #1c2738;
  --playground-border: rgba(151, 163, 190, 0.22);
  --playground-muted: #aeb6ca;
  --playground-text: #f8fafc;
  --playground-radius-md: 0.8rem;
  --playground-radius-lg: 1.15rem;
  --playground-shadow: 0 18px 45px rgba(2, 6, 23, 0.18);
  --playground-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
}

:root[data-theme='light'] {
  color-scheme: light;
  --playground-accent: #6554d9;
  --playground-accent-soft: color-mix(in srgb, #6554d9 14%, transparent);
  --playground-surface: #f8f9fc;
  --playground-surface-raised: #ffffff;
  --playground-border: rgba(51, 65, 85, 0.18);
  --playground-muted: #596276;
  --playground-text: #111827;
  --playground-shadow: 0 18px 45px rgba(30, 41, 59, 0.09);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  min-inline-size: 20rem;
  background: var(--playground-surface);
}

body {
  min-block-size: 100vh;
  min-block-size: 100dvh;
  margin: 0;
  color: var(--playground-text);
  background: var(--playground-surface);
}

.playground-shell__skip {
  position: fixed;
  inset-block-start: 0.5rem;
  inset-inline-start: 0.5rem;
  z-index: 20;
  padding: 0.75rem 1rem;
  border-radius: var(--playground-radius-md);
  color: var(--playground-text);
  background: var(--playground-surface-raised);
  transform: translateY(-150%);
}

.playground-shell__skip:focus {
  transform: none;
}

.playground-shell__header {
  display: flex;
  min-block-size: 4rem;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem clamp(1rem, 3vw, 2rem);
  border-block-end: 1px solid var(--playground-border);
  background: color-mix(
    in srgb,
    var(--playground-surface) 92%,
    transparent
  );
}

.playground-shell__header h1 {
  margin: 0;
  font-size: 1rem;
}

.playground-shell__brand {
  color: var(--playground-text);
  font-weight: 800;
  text-decoration: none;
}

.playground-shell__header nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-inline-start: auto;
}

.playground-shell__header :is(a, button) {
  display: inline-grid;
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  place-items: center;
  padding-inline: 0.75rem;
  border: 1px solid transparent;
  border-radius: var(--playground-radius-md);
  color: var(--playground-text);
  background: transparent;
  font: inherit;
  text-decoration: none;
}

.playground-shell__header :is(a, button):is(:hover, :focus-visible) {
  border-color: var(--playground-accent);
  background: var(--playground-accent-soft);
}

:where(a, button, select, [tabindex]):focus-visible {
  outline: 3px solid var(--playground-accent);
  outline-offset: 2px;
}

#playground-main {
  inline-size: min(100%, 96rem);
  margin-inline: auto;
  padding: clamp(0.75rem, 2vw, 1.5rem);
}

@media (max-width: 32rem) {
  .playground-shell__header {
    flex-wrap: wrap;
  }

  .playground-shell__header nav {
    inline-size: 100%;
    margin-inline-start: 0;
  }
}
```

- [ ] **Step 5: Decouple the existing component CSS from Starlight**

In `playground.css`:

- remove `html:not([data-has-hero]):has(.playground-page)`;
- set the root `.playground` outer margin to `0`;
- mechanically map `--docs-*` to the equivalent `--playground-*` token;
- map `--sl-color-white` to `--playground-text`;
- map `--__sl-font-mono` to `--playground-font-mono`.

In `playground.tsx`, change only:

```tsx
className="playground"
```

The component remains responsible for the example list, toolbar, editor,
console, and their responsive grid. The page remains responsible for document
and header layout.

- [ ] **Step 6: Make the custom route the sole owner and preserve discovery**

Delete `docs/src/content/docs/playground.mdx`. In `docs/astro.config.mjs`, use:

```js
{ label: 'Playground', link: '/playground/' },
```

Remove the now-unreachable `slug === 'playground'` branch from
`docs-page-title.astro`, leaving `guides/`, `reference/`, advanced, and core
labels unchanged.

- [ ] **Step 7: Run focused static and browser checks**

Run:

```bash
npx nx check docs --skip-nx-cache
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4324 \
  node docs/scripts/docs-pages-smoke.mjs
```

Expected: Astro check passes; focused browser contract passes with the existing
hover and warm-run assertions.

- [ ] **Step 8: Commit the standalone route**

```bash
git add docs/astro.config.mjs \
  docs/scripts/docs-pages-smoke.mjs \
  docs/src/components/docs-page-title.astro \
  docs/src/components/playground/playground.css \
  docs/src/components/playground/playground.tsx \
  docs/src/pages/playground.astro \
  docs/src/styles/playground-page.css
git add -u docs/src/content/docs/playground.mdx
git commit -m "feat(docs): move playground to standalone page"
```

---

### Task 3: Verify first paint, theme persistence, and every example

**Files:**
- Modify: `docs/scripts/docs-pages-smoke.mjs`
- Modify: `docs/src/components/playground/playground.css`
- Modify: `docs/src/styles/playground-page.css`

**Interfaces:**
- Consumes: standalone `data-theme`, `[data-theme-toggle]`, the six `playgroundExamples`, and the existing Run/status/console controls
- Produces: readable fallback syntax in both themes and one browser regression gate for all six examples

- [ ] **Step 1: Strengthen the first-paint and theme tests**

Change `checkPlaygroundFirstPaint()` to create light and dark contexts while
blocking external JavaScript bundles. Inline theme bootstrap code still runs,
but the playground island stays on its SSR fallback:

```js
for (const colorScheme of ['light', 'dark']) {
  const firstPaint = await browser.newContext({
    colorScheme,
    viewport: { width: 390, height: 844 },
  });
  try {
    const firstPaintPage = await firstPaint.newPage();
    await firstPaintPage.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') {
        await route.abort();
        return;
      }
      await route.continue();
    });
    await firstPaintPage.goto(`${origin}/playground/`, {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(
      await firstPaintPage.locator('html').getAttribute('data-theme'),
      colorScheme,
    );
    const colors = await firstPaintPage.evaluate(() => {
      const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (value) =>
        rgb(value)
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4,
          )
          .reduce(
            (sum, channel, index) =>
              sum + channel * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const contrast = (foreground, background) => {
        const left = luminance(foreground);
        const right = luminance(background);
        return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
      };
      const editor = document.querySelector('.playground__editor');
      const plain = document.querySelector('.sp-syntax-plain');
      const keyword = document.querySelector('.sp-syntax-keyword');
      if (!editor || !plain || !keyword) throw new Error('Missing SSR editor tokens');
      const background = getComputedStyle(editor).backgroundColor;
      const plainColor = getComputedStyle(plain).color;
      const keywordColor = getComputedStyle(keyword).color;
      return {
        plainColor,
        keywordColor,
        plainContrast: contrast(plainColor, background),
        keywordContrast: contrast(keywordColor, background),
      };
    });
    assert.notEqual(colors.keywordColor, colors.plainColor);
    assert.ok(colors.plainContrast >= 4.5);
    assert.ok(colors.keywordContrast >= 4.5);
  } finally {
    await firstPaint.close();
  }
}
```

In `checkPlayground()`, assert the seeded light theme immediately. After Monaco
and the runtime iframe are ready, append `// theme sentinel`, capture that iframe,
toggle to dark, and assert both survive unchanged. Open a second page in the
same context to prove persistence, then restore light on the original page:

```js
const themeToggle = page.locator('[data-theme-toggle]');
assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
assert.equal(await themeToggle.getAttribute('aria-label'), 'Use dark theme');

await playgroundInput.focus();
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
await page.keyboard.insertText('\n// theme sentinel');
const runtimeBeforeTheme = await runtime.elementHandle();
assert.ok(runtimeBeforeTheme);
await themeToggle.click();
assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
assert.equal(
  await page.evaluate(() => localStorage.getItem('starlight-theme')),
  'dark',
);
assert.equal(await themeToggle.getAttribute('aria-label'), 'Use light theme');
assert.match(await playgroundInput.inputValue(), /theme sentinel/);
assert.equal(
  await runtime.evaluate(
    (currentRuntime, previousRuntime) => currentRuntime.isSameNode(previousRuntime),
    runtimeBeforeTheme,
  ),
  true,
);

const persistedThemePage = await page.context().newPage();
await persistedThemePage.goto(`${origin}/playground/`, {
  waitUntil: 'domcontentloaded',
});
assert.equal(
  await persistedThemePage.locator('html').getAttribute('data-theme'),
  'dark',
);
await persistedThemePage.close();

await themeToggle.click();
assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
await runtimeBeforeTheme.dispose();
await reset.click();
```

Include the brand, Docs, GitHub, and theme controls in the existing 44-pixel
target-size and focus-visible checks.

```js
const shellControls = [
  [header.getByRole('link', { name: '@favy/di', exact: true }), 'Brand'],
  [header.getByRole('link', { name: 'Docs', exact: true }), 'Docs'],
  [header.getByRole('link', { name: 'GitHub', exact: true }), 'GitHub'],
  [themeToggle, 'Theme toggle'],
];
for (const [control, label] of shellControls) {
  await assertMinimumTargetSize(control, label);
  await assertFocusContrast(page, control, label, 'light');
}
```

When `checkExistingDocumentationPages()` later opens the introduction, assert
that its root also resolves the restored preference:

```js
assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
```

- [ ] **Step 2: Run the focused smoke and confirm the light fallback fails**

```bash
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4324 \
  node docs/scripts/docs-pages-smoke.mjs
```

Expected: FAIL because the existing SSR fallback palette is dark-only and does
not reach `4.5:1` contrast on the light surface.

- [ ] **Step 3: Add explicit accessible light and dark fallback palettes**

Add the syntax variables to the dark token block and light override in
`playground-page.css`:

```css
:root {
  --playground-syntax-plain: #d7dae0;
  --playground-syntax-keyword: #c792ea;
  --playground-syntax-definition: #82aaff;
  --playground-syntax-string: #c3e88d;
  --playground-syntax-comment: #9aa3b8;
}

:root[data-theme='light'] {
  --playground-syntax-plain: #1f2937;
  --playground-syntax-keyword: #6d28d9;
  --playground-syntax-definition: #1d4ed8;
  --playground-syntax-string: #166534;
  --playground-syntax-comment: #596276;
}
```

Replace hard-coded fallback colors in `playground.css` with that contract:

```css
astro-island[ssr] .playground .sp-syntax-plain,
astro-island[ssr] .playground .sp-syntax-punctuation {
  color: var(--playground-syntax-plain);
}

astro-island[ssr] .playground .sp-syntax-keyword {
  color: var(--playground-syntax-keyword);
}

astro-island[ssr] .playground .sp-syntax-definition,
astro-island[ssr] .playground .sp-syntax-property {
  color: var(--playground-syntax-definition);
}

astro-island[ssr] .playground .sp-syntax-string {
  color: var(--playground-syntax-string);
}

astro-island[ssr] .playground .sp-syntax-comment {
  color: var(--playground-syntax-comment);
}
```

- [ ] **Step 4: Execute and assert all six bundled examples in the real browser**

Add this data beside `exampleNames`:

```js
const expectedExampleOutput = [
  ['Hello, Ada!'],
  ['Built at 2026-08-04T09:00:00.000Z'],
  ['Built at 2000-01-01T00:00:00.000Z'],
  ['15'],
  ['unused 0', '[1, 1]', '[2, 2]'],
  ['Greeting: hello'],
];
```

After the runtime reaches Ready, select each desktop example button, wait for
Ready, click Run, and wait until every expected fragment is present in the
console. Return to Basic before the existing hover and two-run warm-path checks.
Do not weaken the `<1000ms`, no-registry, no-tooling, or same-iframe assertions.

Use this exact loop:

```js
for (const [index, fragments] of expectedExampleOutput.entries()) {
  await exampleButtons.nth(index).click();
  await status.getByText('Ready', { exact: true }).waitFor({ timeout: 60_000 });
  await run.click();
  await page.waitForFunction(
    (expected) => {
      const output = document.querySelector(
        '[aria-label="Console output"]',
      )?.textContent;
      return expected.every((fragment) => output?.includes(fragment));
    },
    fragments,
    { timeout: 60_000 },
  );
}

await exampleButtons.first().click();
await status.getByText('Ready', { exact: true }).waitFor({ timeout: 60_000 });
```

- [ ] **Step 5: Run focused unit, browser, and production verification**

Run:

```bash
npx nx test docs --skip-nx-cache --runInBand
npx nx check docs --skip-nx-cache
npm --prefix docs run build
test -f docs/dist/playground/index.html
test ! -e docs/src/content/docs/playground.mdx
test -f docs/src/pages/playground.astro
PLAYGROUND_ONLY=1 DOCS_URL=http://127.0.0.1:4324 \
  node docs/scripts/docs-pages-smoke.mjs
DOCS_URL=http://127.0.0.1:4324 node docs/scripts/docs-pages-smoke.mjs
git diff --check
```

Expected: 165 or more Jest tests pass, Astro check/build pass, exactly the
custom route source remains, focused and full browser smoke pass, and warm Run
stays below 1000 ms without registry/tooling reloads.

- [ ] **Step 6: Commit the completed regression coverage**

```bash
git add docs/scripts/docs-pages-smoke.mjs \
  docs/src/components/playground/playground.css \
  docs/src/styles/playground-page.css
git commit -m "test(docs): verify standalone playground"
```

---

## Final Review Gate

Run `git status --short`, confirm only `?? .superpowers/` remains untracked,
review the full branch diff against the approved design, and request a focused
code review of the standalone-route changes before merging or pushing.
