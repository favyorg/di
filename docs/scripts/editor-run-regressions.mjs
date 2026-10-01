import assert from 'node:assert/strict';

const route = '/module/transform-output/#return-typed-api-results';
const sandbox = 'iframe[title="Isolated example execution"]';

async function prepare(
  page,
  origin,
  theme,
  widgetIndex = 0,
  exampleRoute = route
) {
  await page.addInitScript(() => {
    if (window.parent === window) {
      window.runWorkerAudit = { created: 0, terminated: 0 };
      window.addEventListener('message', ({ data }) => {
        if (data?.type === 'regression-worker-created')
          window.runWorkerAudit.created += 1;
        if (data?.type === 'regression-worker-terminated')
          window.runWorkerAudit.terminated += 1;
      });
    } else {
      // Playwright retains workers from removed opaque sandbox frames in its
      // worker list. Observe the real termination call inside that frame.
      const NativeWorker = window.Worker;
      const terminate = NativeWorker.prototype.terminate;
      NativeWorker.prototype.terminate = function (...args) {
        const result = terminate.apply(this, args);
        parent.postMessage({ type: 'regression-worker-terminated' }, '*');
        return result;
      };
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args);
          parent.postMessage({ type: 'regression-worker-created' }, '*');
          return worker;
        },
      });
    }
  });
  await page.goto(`${origin}${exampleRoute}`);
  await page
    .locator('.editor-files')
    .nth(widgetIndex)
    .locator('.inputarea')
    .waitFor();
  await page.evaluate(
    async ({ theme, widgetIndex }) => {
      document.documentElement.dataset.theme = theme;
      const url = performance
        .getEntriesByType('resource')
        .find(({ name }) =>
          /\/(?:editor\.api\.[^/]+|monaco-editor_esm_vs_editor_editor__api)\.js(?:\?|$)/.test(
            name
          )
        )?.name;
      if (!url) throw new Error('Monaco editor API module was not loaded');
      const module = await import(url);
      const monaco = module.editor?.getEditors
        ? module
        : Object.values(module).find((value) => value?.editor?.getEditors);
      const widget = document.querySelectorAll('.editor-files')[widgetIndex];
      const editor = monaco.editor
        .getEditors()
        .find((entry) => widget.contains(entry.getDomNode()));
      const base = editor
        .getModel()
        .uri.toString()
        .replace(/[^/]+$/, '');
      window.runRegression = {
        monaco,
        editor,
        widget,
        island: widget.closest('astro-island'),
        models: Object.fromEntries(
          monaco.editor
            .getModels()
            .filter((model) => model.uri.toString().startsWith(base))
            .map((model) => [model.uri.path.split('/').at(-1), model])
        ),
      };
    },
    { theme, widgetIndex }
  );
  await page.waitForFunction(
    (theme) =>
      window.runRegression.editor
        .getDomNode()
        .classList.contains(theme === 'dark' ? 'vs-dark' : 'vs'),
    theme
  );
}

const runButton = (page, widgetIndex = 0) =>
  page
    .locator('.editor-files')
    .nth(widgetIndex)
    .getByRole('button', { name: 'Run app.ts' });
const output = (page, widgetIndex = 0) =>
  page
    .locator('.editor-files')
    .nth(widgetIndex)
    .getByRole('region', { name: 'Example output' });

async function start(page, key, widgetIndex = 0) {
  const button = runButton(page, widgetIndex);
  if (key) {
    await button.focus();
    await page.keyboard.press(key);
  } else {
    await button.click();
  }
}

async function waitForStatus(page, status, timeout = 30_000, widgetIndex = 0) {
  await page.waitForFunction(
    ({ status, widgetIndex }) =>
      document
        .querySelectorAll('.editor-files')
        [widgetIndex]?.querySelector('.example-run-console [role="status"]')
        ?.textContent === status,
    { status, widgetIndex },
    { timeout }
  );
}

async function assertDisposed(page) {
  await page.waitForFunction(
    (selector) => !document.querySelector(selector),
    sandbox,
    { timeout: 3000 }
  );
  await page.waitForFunction(
    () => window.runWorkerAudit.created === window.runWorkerAudit.terminated,
    undefined,
    { timeout: 3000 }
  );
}

async function complete(page, expected, key, widgetIndex = 0) {
  await start(page, key, widgetIndex);
  await waitForStatus(page, 'Finished', 30_000, widgetIndex);
  assert.equal(
    await output(page, widgetIndex).getByRole('log').textContent(),
    expected
  );
  await assertDisposed(page);
}

async function setFiles(page, entry, dependencies = {}) {
  await page.evaluate(
    (files) => {
      for (const [name, code] of Object.entries(files)) {
        window.runRegression.models[name].setValue(code);
      }
    },
    {
      'api-module.ts': 'export {};',
      'api-types.ts': 'export {};',
      'loaders.ts': 'export {};',
      'main.ts': 'export {};',
      ...dependencies,
      'app.ts': entry,
    }
  );
}

async function failed(page, source, match) {
  await setFiles(page, source);
  await start(page);
  await waitForStatus(page, 'Failed');
  const text = await output(page).getByRole('log').textContent();
  assert.match(text, match);
  assert.doesNotMatch(text, /SHOULD NOT EXECUTE/);
  await assertDisposed(page);
}

async function assertLayout(page) {
  await runButton(page).scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const widget = window.runRegression.widget;
    const button = widget.querySelector('.example-run-button');
    const console = widget.querySelector('.example-run-console');
    const viewport = document.documentElement.clientWidth;
    return {
      documentFits: document.documentElement.scrollWidth <= viewport + 1,
      controlsFit: [button, console].every((node) => {
        const bounds = node.getBoundingClientRect();
        return (
          bounds.width > 0 && bounds.left >= 0 && bounds.right <= viewport + 1
        );
      }),
      logFits:
        console.querySelector('[role="log"]').scrollWidth <=
        console.clientWidth + 1,
    };
  });
  assert.deepEqual(layout, {
    documentFits: true,
    controlsFit: true,
    logFits: true,
  });
}

async function assertLifecycle(page, origin) {
  // Exercise edits in separate tabs and preserve the actual import graph.
  await setFiles(
    page,
    "import { next } from './loaders';\nconsole.log('first', next());",
    {
      'api-module.ts': 'export const prefix = "dependency";',
      'loaders.ts':
        "import { prefix } from './api-module';\nlet count = 0;\nexport const next = () => `${prefix} ${++count}`;",
    }
  );
  await complete(page, 'first dependency 1\n');
  await page
    .locator('.editor-files')
    .first()
    .getByRole('tab', { name: 'api-module.ts', exact: true })
    .click();
  await page.evaluate(() =>
    window.runRegression.editor.setValue(
      'export const prefix = "edited dependency";'
    )
  );
  await page
    .locator('.editor-files')
    .first()
    .getByRole('tab', { name: 'app.ts', exact: true })
    .click();
  await page.evaluate(() =>
    window.runRegression.editor.setValue(
      "import { next } from './loaders';\nconsole.log('edited main', next());"
    )
  );
  await complete(page, 'edited main edited dependency 1\n', 'Enter');
  await complete(page, 'edited main edited dependency 1\n', 'Space');

  await failed(
    page,
    'console.log("SHOULD NOT EXECUTE");\nconst value: number = "wrong";',
    /app\.ts:2:\d+ — TS2322/
  );
  await failed(
    page,
    'console.log("SHOULD NOT EXECUTE");\nconst value = ;',
    /app\.ts:2:\d+ — TS\d+/
  );
  for (const [source, match] of [
    ['throw new Error("synchronous failure");', /synchronous failure/],
    ['void Promise.reject(new Error("async failure"));', /async failure/],
    [
      'setTimeout(() => { throw new Error("timer failure"); }, 30);',
      /timer failure/,
    ],
  ]) {
    await failed(page, source, match);
  }
  await setFiles(
    page,
    'console.log("immediate");\nsetTimeout(() => console.log("delayed"), 80);'
  );
  await complete(page, 'immediate\ndelayed\n');

  const html = '<img src=x onerror="window.__exampleExecuted = true">';
  await setFiles(page, `console.log(${JSON.stringify(html)});`);
  await complete(page, `${html}\n`);
  assert.equal(await output(page).locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.__exampleExecuted), undefined);

  let networkRequests = 0;
  await page.route(
    'https://example.invalid/__docs-run-network__',
    (request) => {
      networkRequests += 1;
      return request.abort();
    }
  );
  await setFiles(
    page,
    'void fetch("https://example.invalid/__docs-run-network__").then(() => console.log("unexpected network"), () => console.log("network blocked"));'
  );
  await complete(page, 'network blocked\n');
  assert.equal(
    networkRequests,
    0,
    'The example sandbox must block network access'
  );

  await setFiles(page, 'console.log("loop started");\nwhile (true) {}');
  await start(page);
  await page.waitForFunction(() =>
    document
      .querySelector('.example-run-console [role="log"]')
      ?.textContent.includes('loop started')
  );
  assert.equal(await page.locator(sandbox).count(), 1);
  assert.ok(
    await page.evaluate(
      () =>
        window.runWorkerAudit.created === window.runWorkerAudit.terminated + 1
    ),
    'The loop must run in a worker that Stop can terminate'
  );
  await page
    .getByRole('button', { name: 'Stop example' })
    .click({ timeout: 2000 });
  await waitForStatus(page, 'Stopped', 2000);
  await assertDisposed(page);
  await setFiles(page, 'console.log("after stop");');
  await complete(page, 'after stop\n');

  await failed(page, 'while (true) {}', /timed out after 5 seconds/);
  await setFiles(page, 'console.log("after timeout");');
  await complete(page, 'after timeout\n');

  await setFiles(page, 'console.log("unmount loop");\nwhile (true) {}');
  await start(page);
  await page.waitForFunction(() =>
    document
      .querySelector('.example-run-console [role="log"]')
      ?.textContent.includes('unmount loop')
  );
  await page.evaluate(() =>
    window.runRegression.island.dispatchEvent(new CustomEvent('astro:unmount'))
  );
  await assertDisposed(page);
  assert.equal(
    await page.evaluate(() =>
      window.runRegression.island.querySelector('.editor-files')
    ),
    null
  );
  assert.equal(new URL(page.url()).origin, new URL(origin).origin);
}

async function assertGeneratorExample(browser, origin) {
  const widgetIndex = 0;
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await prepare(page, origin, theme, widgetIndex, '/module/generator/');
      assert.equal(
        await page
          .locator('.editor-files')
          .nth(widgetIndex)
          .getByRole('tab', { name: 'main.ts', exact: true })
          .getAttribute('aria-selected'),
        'true',
        'The generator example must open on its yield* composition'
      );
      const diagnostics = await page.evaluate(async () => {
        const { monaco, editor, models } = window.runRegression;
        const getWorker =
          await monaco.languages.typescript.getTypeScriptWorker();
        // Ask for the active file only: unopened imports must already be synced.
        const worker = await getWorker(editor.getModel().uri);
        return Promise.all(
          Object.entries(models).map(async ([name, model]) => {
            const uri = model.uri.toString();
            const errors = [
              ...(await worker.getSyntacticDiagnostics(uri)),
              ...(await worker.getSemanticDiagnostics(uri)),
            ];
            return {
              name,
              errors: errors.map(({ code, messageText }) => ({
                code,
                messageText,
              })),
            };
          })
        );
      });
      assert.deepEqual(
        diagnostics.map(({ name }) => name).sort(),
        ['api-types.ts', 'app.ts', 'contracts.ts', 'loaders.ts', 'main.ts'],
        'The generator example must load its real source files'
      );
      for (const file of diagnostics) {
        assert.deepEqual(
          file.errors,
          [],
          `Generator example ${file.name} must type-check in ${theme} theme`
        );
      }
      await complete(page, 'Alex\n1\n', undefined, widgetIndex);

      await page
        .locator('.editor-files')
        .nth(widgetIndex)
        .getByRole('tab', { name: 'app.ts', exact: true })
        .click();
      await page.evaluate(() => {
        const { editor } = window.runRegression;
        if (!editor.getModel().uri.path.endsWith('/app.ts')) {
          throw new Error('The generator app.ts tab must activate its model');
        }
        const source = editor.getValue();
        if (!source.includes("name: 'Alex'")) {
          throw new Error('The generator example must contain the API mock');
        }
        editor.setValue(source.replace("name: 'Alex'", "name: 'Sam'"));
      });
      await complete(page, 'Sam\n1\n', 'Enter', widgetIndex);
      assert.deepEqual(
        errors,
        [],
        'Running and editing the generator example must not raise page errors'
      );
      console.log(`Generator example Run regressions passed: ${theme}`);
    } finally {
      await page.close();
    }
  }
}

export async function assertEditorRun(browser, origin) {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: theme,
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await prepare(page, origin, theme);
        await complete(page, 'Alex\n1\n');
        await assertLayout(page);
        if (width === 390) {
          await page.setViewportSize({ width: 320, height: 900 });
          await assertLayout(page);
        }
        if (width === 1440 && theme === 'light') {
          await assertLifecycle(page, origin);
        }
        assert.deepEqual(
          errors,
          [],
          'Running examples must not raise page errors'
        );
        console.log(`Editor Run regressions passed: ${width}px ${theme}`);
      } finally {
        await page.close();
      }
    }
  }
  await assertGeneratorExample(browser, origin);
}
