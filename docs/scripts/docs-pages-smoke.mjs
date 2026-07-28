import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.DOCS_URL ?? 'http://127.0.0.1:4321';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'dark',
});
const page = await context.newPage();

const assertMinimumTargetSize = async (locator, label) => {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} should be visible`);
  assert.ok(box.width >= 44, `${label} width was ${box.width}px`);
  assert.ok(box.height >= 44, `${label} height was ${box.height}px`);
};

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

  await page.locator('.sl-markdown-content').evaluate((content) => {
    const fixture = document.createElement('div');
    fixture.dataset.smokeContentPrimitives = '';
    fixture.innerHTML = `
      <nav class="api-index" aria-label="API symbols">
        <strong>Common API</strong>
        <a href="#module">Module</a>
      </nav>
      <details class="api-declaration">
        <summary>Full declaration</summary>
        <p>Declaration</p>
      </details>
      <dl class="example-contract">
        <dt>Boundary</dt>
        <dd>UserApi</dd>
      </dl>
    `;
    content.append(fixture);
  });

  const contentPrimitives = page.locator('[data-smoke-content-primitives]');
  await assertMinimumTargetSize(
    contentPrimitives.locator('.api-index a'),
    'API index link',
  );
  await assertMinimumTargetSize(
    contentPrimitives.locator('details > summary'),
    'Content details summary',
  );

  const originalTheme = await page.locator('html').getAttribute('data-theme');
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((element, value) => {
      element.setAttribute('data-theme', value);
    }, theme);
    const contrast = await contentPrimitives
      .locator('.example-contract dt')
      .evaluate((term) => {
        const channels = (value) => {
          const values = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
          if (!values) throw new Error(`Unsupported color: ${value}`);
          return value.startsWith('color(srgb')
            ? values
            : values.map((channel) => channel / 255);
        };
        const luminance = (value) =>
          channels(value)
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
        const style = getComputedStyle(term);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
    assert.ok(
      contrast >= 4.5,
      `Example contract term ${theme} contrast was ${contrast.toFixed(2)}:1`,
    );
  }
  await page.locator('html').evaluate((element, theme) => {
    if (theme) element.setAttribute('data-theme', theme);
    else element.removeAttribute('data-theme');
  }, originalTheme);
  await contentPrimitives.evaluate((fixture) => fixture.remove());

  await page.waitForSelector('.monaco-editor', { timeout: 15_000 });

  const editorSurface = await page
    .locator("astro-island[component-export='Editor']")
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
      .locator("astro-island[component-export='Editor']")
      .first()
      .evaluate((element) => getComputedStyle(element, '::before').content),
    /scroll|swipe/i,
  );

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
      .locator(
        "astro-island[component-export='Editor'] pre[aria-label='TypeScript example']",
      )
      .count(),
  );
  await noScript.close();

  await page.goto(`${origin}/guides/testing/`, {
    waitUntil: 'domcontentloaded',
  });
  assert.equal(await page.locator('dl.example-contract').count(), 5);
  assert.deepEqual(
    await page.locator('dl.example-contract dt').allTextContents(),
    Array(5).fill(['Boundary', 'Kept real', 'Replaced', 'Proves']).flat(),
  );

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

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('.docs-page-title').count(), 0);
  assert.equal(await page.locator('.home-workbench').count(), 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/guides/introduction/`, {
    waitUntil: 'domcontentloaded',
  });

  const menuButton = page.locator('starlight-menu-button button');
  await assertMinimumTargetSize(menuButton, 'Mobile menu button');
  await menuButton.click();
  await page.waitForFunction(() =>
    document.body.hasAttribute('data-mobile-menu-expanded'),
  );

  await assertMinimumTargetSize(
    page.locator('.sidebar-pane a[aria-current="page"]'),
    'Current sidebar link',
  );
  await assertMinimumTargetSize(
    page.locator('.sidebar-pane summary').first(),
    'Sidebar group summary',
  );

  await menuButton.click();
  await page.waitForFunction(
    () => !document.body.hasAttribute('data-mobile-menu-expanded'),
  );
  await page.locator('mobile-starlight-toc summary').click();
  await assertMinimumTargetSize(
    page.locator('mobile-starlight-toc .dropdown a').first(),
    'Mobile table of contents link',
  );
} finally {
  await browser.close();
}

console.log('Documentation page contract passed');
