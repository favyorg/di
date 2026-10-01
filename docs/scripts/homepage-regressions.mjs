import assert from 'node:assert/strict';
import { startBrowserSession } from './browser-session.mjs';

const { browser, origin, close } = await startBrowserSession();

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();

  await page.goto(origin, { waitUntil: 'networkidle' });

  assert.equal(
    (await page.locator('.home .hero-title').textContent())?.trim(),
    'Dependency graphs, just typed functions.'
  );
  assert.equal(
    await page
      .getByRole('heading', {
        level: 1,
        name: 'Dependency graphs, just typed functions.',
      })
      .count(),
    1
  );
  assert.equal(await page.locator('.home-workbench').count(), 1);
  assert.equal(await page.locator('.monaco-editor').count(), 0);
  assert.equal(await page.locator('main img').count(), 0);
  const quickStartSource = await page.locator('.code-block code').innerText();
  assert.match(quickStartSource, /type ClockLive = typeof Clock\.Live;/);
  assert.match(quickStartSource, /Module<ClockLive>\(\)/);
  assert.doesNotMatch(quickStartSource, /Module<typeof Clock\.Live>/);
  const codeRhythm = await page.locator('.code-block').evaluate((element) => {
    const lines = [...element.querySelectorAll('.code-line')].slice(0, 2);
    const first = lines[0]?.getBoundingClientRect();
    const second = lines[1]?.getBoundingClientRect();

    return {
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      step:
        first !== undefined && second !== undefined
          ? second.top - first.top
          : Number.POSITIVE_INFINITY,
    };
  });
  assert.ok(
    codeRhythm.step <= codeRhythm.lineHeight * 1.05,
    `Code rows are double-spaced: ${codeRhythm.step}px step for ${codeRhythm.lineHeight}px line-height`
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--sl-content-width')
        .trim()
    ),
    '67.5rem',
    'Homepage must not change the shared Starlight shell width'
  );

  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  assert.equal(await skipLink.getAttribute('href'), '#_top');
  const skipPosition = await page.evaluate(() => ({
    target: document.querySelector('#_top')?.getBoundingClientRect().top,
    content: document.querySelector('.home-workbench')?.getBoundingClientRect()
      .top,
  }));
  assert.ok(
    skipPosition.target !== undefined &&
      skipPosition.content !== undefined &&
      Math.abs(skipPosition.target - skipPosition.content) <= 2,
    'Skip-link target is not aligned with visible homepage content'
  );
  await skipLink.focus();
  await skipLink.press('Enter');
  await page.waitForFunction(() => location.hash === '#_top');

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
      `Missing homepage link: ${path}`
    );
  }

  const installCopy = page.locator('[data-copy-value="npm install @favy/di"]');
  assert.equal(
    await installCopy.getAttribute('aria-label'),
    'Copy install command'
  );
  await installCopy.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-copy-value="npm install @favy/di"]')
        ?.dataset.copyState === 'copied'
  );
  assert.equal(
    await installCopy.getAttribute('aria-label'),
    'Install command copied'
  );

  const codeCopy = page.locator('[data-copy]').nth(1);
  assert.equal(
    await codeCopy.getAttribute('aria-label'),
    'Copy quick start code'
  );
  assert.match(
    (await codeCopy.getAttribute('data-copy-value')) ?? '',
    /type ClockLive = typeof Clock\.Live;[\s\S]*Module<ClockLive>\(\)/
  );
  await codeCopy.click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-copy]')[1]?.dataset.copyState ===
      'copied'
  );
  assert.equal(
    await codeCopy.getAttribute('aria-label'),
    'Quick start code copied'
  );

  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true,
    'Homepage has horizontal overflow at 320 px'
  );

  for (const width of [901, 1024, 1100, 1120, 1121, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.workbench-grid');
      const title = document.querySelector('.hero-title');
      const demo = document.querySelector('.demo-panel');
      const columns = grid
        ? getComputedStyle(grid).gridTemplateColumns.split(' ').length
        : 0;
      const titleRect = title?.getBoundingClientRect();
      const demoRect = demo?.getBoundingClientRect();

      return {
        columns,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        overlap:
          columns > 1 &&
          titleRect !== undefined &&
          demoRect !== undefined &&
          titleRect.right > demoRect.left,
      };
    });

    assert.equal(layout.overflow, false, `Homepage overflows at ${width} px`);
    assert.equal(layout.overlap, false, `Hero overlaps at ${width} px`);
    if (width <= 1120) {
      assert.equal(layout.columns, 1, `Hero must stack at ${width} px`);
    }
  }

  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390, 320]) {
      const runContext = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      await runContext.addInitScript((value) => {
        localStorage.setItem('starlight-theme', value);
      }, theme);
      const runPage = await runContext.newPage();
      const errors = [];
      runPage.on('pageerror', (error) => errors.push(error.message));
      // Fix Date without pausing the page's animation frames or clipboard timers.
      await runPage.clock.setFixedTime(new Date('2026-01-02T03:04:05.000Z'));
      await runPage.goto(origin, { waitUntil: 'networkidle' });
      assert.equal(
        await runPage.locator('html').getAttribute('data-theme'),
        theme
      );
      const run = runPage.getByRole('button', { name: 'Run greeting.ts' });
      const output = runPage.locator('#greeting-output');
      await run.waitFor({ state: 'visible' });
      assert.equal(await output.isVisible(), false);
      assert.equal(await output.getAttribute('aria-live'), 'polite');

      await run.click();
      assert.equal(await output.isVisible(), true);
      assert.equal(
        await output.innerText(),
        'Hello at 2026-01-02T03:04:05.000Z'
      );

      await runPage.clock.setFixedTime(new Date('2026-01-02T03:04:06.000Z'));
      await run.focus();
      await run.press('Enter');
      assert.equal(
        await output.innerText(),
        'Hello at 2026-01-02T03:04:06.000Z'
      );
      await runPage.clock.setFixedTime(new Date('2026-01-02T03:04:07.000Z'));
      await run.press('Space');
      assert.equal(
        await output.innerText(),
        'Hello at 2026-01-02T03:04:07.000Z'
      );

      const target = await run.boundingBox();
      assert.ok(target && target.width >= 44 && target.height >= 44);
      const layout = await runPage.evaluate(() => {
        const bounds = (selector) =>
          document.querySelector(selector).getBoundingClientRect();
        const file = bounds('.panel-file');
        const actions = bounds('.panel-actions');
        const panel = bounds('.panel-bar');
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          overlap: file.right > actions.left,
          clippedActions: actions.right > panel.right,
        };
      });
      assert.deepEqual(layout, {
        overflow: false,
        overlap: false,
        clippedActions: false,
      });

      const source = (
        await runPage.locator('.code-line').allTextContents()
      ).join('\n');
      const copy = runPage.getByRole('button', {
        name: 'Copy quick start code',
      });
      assert.equal(await copy.getAttribute('data-copy-value'), source);
      await runPage.keyboard.press('Tab');
      assert.ok(
        await copy.evaluate((button) => button === document.activeElement)
      );
      await copy.click();
      await runPage.waitForFunction(
        () =>
          document.querySelector('.code-copy').dataset.copyState === 'copied'
      );
      assert.equal(
        await runPage.evaluate(() => navigator.clipboard.readText()),
        source
      );
      assert.deepEqual(
        errors,
        [],
        `Homepage browser errors (${width}px ${theme})`
      );
      console.log(`Greeting Run passed: ${width}px ${theme}`);
      await runContext.close();
    }
  }

  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(
    (await noScriptPage.locator('.home .hero-title').textContent())?.trim(),
    'Dependency graphs, just typed functions.'
  );
  assert.equal(await noScriptPage.locator('[data-copy]:visible').count(), 0);
  assert.equal(
    await noScriptPage.locator('[data-run-greeting]').isVisible(),
    false
  );
  assert.equal(
    await noScriptPage.locator('[data-run-output]').isVisible(),
    false
  );
  assert.ok(await noScriptPage.locator('.code-block').isVisible());
  assert.equal(
    (await noScriptPage.locator('a[href="/guides/introduction/"]').count()) > 0,
    true
  );
  await noScriptContext.close();
} finally {
  await close();
}

console.log('Homepage browser contract passed');
