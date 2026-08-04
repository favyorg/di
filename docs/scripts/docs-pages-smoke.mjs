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

const assertFocusContrast = async (page, locator, label, theme) => {
  await page.keyboard.press('Tab');
  await locator.focus();
  const focus = await locator.evaluate((element) => {
    const parseColor = (value) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) {
        throw new Error(`Unsupported color: ${value}`);
      }
      const rgb = value.startsWith('color(srgb')
        ? channels.slice(0, 3)
        : channels.slice(0, 3).map((channel) => channel / 255);
      return [...rgb, channels[3] ?? 1];
    };
    const over = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [
        ...foreground
          .slice(0, 3)
          .map(
            (channel, index) =>
              (channel * foreground[3] +
                background[index] * background[3] * (1 - foreground[3])) /
              alpha,
          ),
        alpha,
      ];
    };
    const layers = [];
    let parent = element.parentElement;
    while (parent) {
      const color = parseColor(getComputedStyle(parent).backgroundColor);
      layers.push(color);
      if (color[3] === 1) break;
      parent = parent.parentElement;
    }
    let background = layers.pop() ?? [1, 1, 1, 1];
    while (layers.length) background = over(layers.pop(), background);
    const luminance = ([red, green, blue]) =>
      [red, green, blue]
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
    const style = getComputedStyle(element);
    const foreground = luminance(parseColor(style.outlineColor));
    const adjacent = luminance(background);
    return {
      contrast:
        (Math.max(foreground, adjacent) + 0.05) /
        (Math.min(foreground, adjacent) + 0.05),
      focusVisible: element.matches(':focus-visible'),
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  assert.equal(focus.focusVisible, true, `${label} should be focus-visible`);
  assert.ok(
    focus.outlineWidth >= 2,
    `${label} outline was ${focus.outlineWidth}px`,
  );
  assert.ok(
    focus.contrast >= 3,
    `${label} ${theme} focus contrast was ${focus.contrast.toFixed(2)}:1`,
  );
};

const checkPlayground = async (page) => {
  await page.goto(`${origin}/playground/`, { waitUntil: 'domcontentloaded' });
  assert.equal(
    (await page.locator('.docs-page-label').textContent())?.trim(),
    'Playground',
  );
  assert.equal(
    (await page.locator('.docs-page-title h1').textContent())?.trim(),
    'Playground',
  );

  const exampleNames = [
    'Basic module',
    'Composition',
    'Replace a boundary',
    'Partial application',
    'Lazy and cache',
    'HKT transform',
  ];
  const exampleNavigation = page.getByRole('navigation', {
    name: 'Playground examples',
  });
  const exampleButtons = exampleNavigation.getByRole('button');
  assert.equal(await exampleButtons.count(), exampleNames.length);
  assert.deepEqual(
    await exampleButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    ),
    exampleNames,
  );
  const provider = page.locator('.playground__sandbox .sp-wrapper');
  await provider.waitFor({ timeout: 30_000 });
  assert.equal(await provider.count(), 1);
  assert.equal(
    await page.locator('.playground__editor .sp-code-editor').count(),
    1,
  );

  const outerEditor = page.locator(
    '[aria-label="TypeScript playground editor"][role="textbox"][tabindex="0"]',
  );
  const codeEditor = page.locator(
    '.cm-content[aria-label="TypeScript playground editor"][contenteditable="true"]',
  );
  await outerEditor.waitFor({ timeout: 30_000 });
  await codeEditor.waitFor({ timeout: 30_000 });
  assert.equal(await outerEditor.count(), 1);
  assert.equal(await codeEditor.count(), 1);

  for (const [index, name] of exampleNames.entries()) {
    await assertMinimumTargetSize(exampleButtons.nth(index), name);
  }
  const reset = page.getByRole('button', { name: 'Reset example' });
  const run = page.getByRole('button', { name: 'Run code' });
  await assertMinimumTargetSize(reset, 'Reset example');
  await assertMinimumTargetSize(run, 'Run code');

  const originalTheme = await page.locator('html').getAttribute('data-theme');
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => {
      element.setAttribute('data-theme', value);
    }, theme);
    await assertFocusContrast(
      page,
      exampleButtons.first(),
      'Basic module',
      theme,
    );
    await assertFocusContrast(page, reset, 'Reset example', theme);
    await assertFocusContrast(page, run, 'Run code', theme);
  }

  const consoleOutput = page.getByRole('region', { name: 'Console output' });
  await outerEditor.press('Control+Enter');
  await consoleOutput
    .getByText('Hello, Ada!', { exact: false })
    .waitFor({ timeout: 60_000 });
  await page.getByRole('status').getByText('Ready', { exact: true }).waitFor();

  await codeEditor.click();
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
  );
  await page.keyboard.insertText(
    "import { Module } from '@favy/di\nconsole.log('SHOULD NOT RUN')",
  );
  await page
    .getByRole('status')
    .getByText('Checking imports', { exact: true })
    .waitFor();
  await page.waitForTimeout(1_100);
  assert.equal(
    (await page.getByRole('status').textContent())?.trim(),
    'Checking imports',
  );
  await run.click();
  assert.equal(await run.isDisabled(), false);
  assert.equal(
    await page
      .getByRole('toolbar', { name: 'Playground controls' })
      .getAttribute('aria-busy'),
    'false',
  );
  assert.equal(
    (await page.getByRole('status').textContent())?.trim(),
    'Checking imports',
  );
  assert.equal(
    (await consoleOutput.textContent())?.includes('SHOULD NOT RUN'),
    false,
  );

  await reset.click();
  await page.getByRole('status').getByText('Ready', { exact: true }).waitFor();
  assert.equal(
    (await consoleOutput.textContent())?.includes('Hello, Ada!'),
    false,
  );
  await outerEditor.press('Control+Enter');
  await consoleOutput
    .getByText('Hello, Ada!', { exact: false })
    .waitFor({ timeout: 60_000 });

  await page.setViewportSize({ width: 320, height: 900 });
  const exampleSelect = page.getByRole('combobox', { name: 'Example' });
  assert.equal(await exampleSelect.isVisible(), true);
  await assertMinimumTargetSize(exampleSelect, 'Example select');
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => {
      element.setAttribute('data-theme', value);
    }, theme);
    await assertFocusContrast(page, exampleSelect, 'Example select', theme);
  }
  await exampleSelect.selectOption({ label: 'HKT transform' });
  await page.waitForFunction(() =>
    document.querySelector('.cm-content')?.textContent?.includes('BoxHKT'),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await outerEditor.press('Meta+Enter');
  await consoleOutput
    .getByText('Greeting: hello', { exact: false })
    .waitFor({ timeout: 60_000 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );

  await page.locator('html').evaluate((element, theme) => {
    if (theme) element.setAttribute('data-theme', theme);
    else element.removeAttribute('data-theme');
  }, originalTheme);
  await page.setViewportSize({ width: 1440, height: 1000 });
};

const checkExistingDocumentationPages = async (page, browser) => {
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

  const editorLineRhythm = await page
    .locator("astro-island[component-export='Editor']")
    .first()
    .locator('.monaco-editor .view-line')
    .evaluateAll((lines) => {
      const blankLineIndex = lines.findIndex(
        (line, index) => index > 0 && !line.textContent?.trim(),
      );
      if (blankLineIndex < 1) return null;
      const previousLine = lines[blankLineIndex - 1].getBoundingClientRect();
      const blankLine = lines[blankLineIndex].getBoundingClientRect();
      return {
        lineHeight: previousLine.height,
        blankLineDelta: blankLine.top - previousLine.top,
      };
    });
  assert.ok(editorLineRhythm, 'Editor should render a real blank code line');
  assert.ok(
    Math.abs(editorLineRhythm.blankLineDelta - editorLineRhythm.lineHeight) <=
      1,
    `Editor blank-line delta was ${editorLineRhythm.blankLineDelta}px for a ${editorLineRhythm.lineHeight}px line`,
  );

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

  const expectedTestingContracts = [
    [
      ['Boundary', 'UserApi'],
      ['Kept real', 'UserApi'],
      ['Replaced', 'HttpClient'],
      ['Proves', 'Returned user and requested URL'],
    ],
    [
      ['Boundary', 'Database'],
      ['Kept real', 'UserRepository → UserService'],
      ['Replaced', 'Database'],
      ['Proves', 'Service output and forwarded user ID'],
    ],
    [
      ['Boundary', 'Mailer'],
      ['Kept real', 'WelcomeMessage'],
      ['Replaced', 'Mailer via .provide()'],
      ['Proves', 'Message payload and isolated fixture state'],
    ],
    [
      ['Boundary', 'CachedModule factory'],
      ['Kept real', 'Counter'],
      ['Replaced', 'Nothing; the owned cache is reset'],
      ['Proves', 'One initialization per test'],
    ],
    [
      ['Boundary', 'ExpensiveFeature access'],
      ['Kept real', 'App and ExpensiveFeature'],
      ['Replaced', 'Nothing; initialization is observed'],
      [
        'Proves',
        'The disabled branch stays lazy and the enabled branch resolves once',
      ],
    ],
  ];
  const testingContracts = await page
    .locator('dl.example-contract')
    .evaluateAll((contracts) =>
      contracts.map((contract, contractIndex) => {
        let editor = contract.nextElementSibling;
        if (
          contractIndex === 0 &&
          editor?.tagName === 'STYLE' &&
          editor.nextElementSibling?.tagName === 'SCRIPT'
        ) {
          editor = editor.nextElementSibling.nextElementSibling;
        }
        const elements = [...contract.children];
        return {
          pairs: Array.from(
            { length: Math.ceil(elements.length / 2) },
            (_, pairIndex) => {
              const label = elements[pairIndex * 2];
              const value = elements[pairIndex * 2 + 1];
              return [
                label?.tagName,
                label?.textContent?.trim(),
                value?.tagName,
                value?.textContent?.trim(),
              ];
            },
          ),
          adjacentEditor:
            editor?.matches(
              "astro-island[component-export='Editor']",
            ) ?? false,
        };
      }),
    );
  assert.deepEqual(
    testingContracts,
    expectedTestingContracts.map((pairs) => ({
      pairs: pairs.map(([label, value]) => ['DT', label, 'DD', value]),
      adjacentEditor: true,
    })),
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

  await page.goto(`${origin}/module/lazy/`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.monaco-editor', { timeout: 15_000 });

  const lazyExampleIndents = await page
    .locator("astro-island[component-export='Editor']")
    .evaluateAll((editors) =>
      editors.map((editor) =>
        [...editor.querySelectorAll('.view-line')]
          .filter((line) =>
            /^\s*(?:'(?:IgnoreResource|ReadTwice)'|\(\) =>|\(\w+\) =>)/.test(
              (line.textContent ?? '').replaceAll('\u00a0', ' '),
            ),
          )
          .map(
            (line) =>
              line.textContent?.match(/^(?:\s|\u00a0)*/)?.[0].length ?? 0,
          ),
      ),
    );
  assert.deepEqual(lazyExampleIndents, [
    [2, 2, 2, 2],
    [2, 2],
  ]);

  await page.goto(`${origin}/module/partial/`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.monaco-editor', { timeout: 15_000 });

  const partialExampleIndents = await page
    .locator("astro-island[component-export='Editor']")
    .first()
    .locator('.view-line')
    .evaluateAll((lines) =>
      lines
        .filter((line) =>
          /^\s*(?:'Calculator'|\(\{ x, y \}\) =>)/.test(
            (line.textContent ?? '').replaceAll('\u00a0', ' '),
          ),
        )
        .map(
          (line) =>
            line.textContent?.match(/^(?:\s|\u00a0)*/)?.[0].length ?? 0,
        ),
    );
  assert.deepEqual(partialExampleIndents, [2, 2]);

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('.docs-page-title').count(), 0);
  assert.equal(await page.locator('.home-workbench').count(), 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/guides/introduction/`, {
    waitUntil: 'domcontentloaded',
  });

  await assertMinimumTargetSize(
    page.locator('site-search > button'),
    'Mobile docs search button',
  );
  await assertMinimumTargetSize(
    page
      .locator('.expressive-code button[title="Copy to clipboard"]')
      .first(),
    'Mobile code copy button',
  );

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
};

try {
  await checkPlayground(page);
  if (process.env.PLAYGROUND_ONLY !== '1') {
    await checkExistingDocumentationPages(page, browser);
  }
} finally {
  await browser.close();
}

console.log(
  process.env.PLAYGROUND_ONLY === '1'
    ? 'Playground page contract passed'
    : 'Documentation page contract passed',
);
