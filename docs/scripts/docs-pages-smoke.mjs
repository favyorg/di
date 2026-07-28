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
