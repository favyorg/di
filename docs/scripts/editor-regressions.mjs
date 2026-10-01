import assert from 'node:assert/strict';
import { startBrowserSession } from './browser-session.mjs';
import { assertEditorFiles } from './editor-files-regressions.mjs';
import { assertEditorRun } from './editor-run-regressions.mjs';

const fixtures = {
  suggest: { selector: '.suggest-widget', text: 'reviewMember' },
  hover: { selector: '.monaco-hover', text: 'reviewMember' },
  hints: { selector: '.parameter-hints-widget', text: 'first: number' },
};

async function positionEditor(page) {
  await page.evaluate(async () => {
    const editor = window.editorRegression.editor;
    editor.setScrollTop(0);
    window.scrollTo(
      0,
      window.scrollY + editor.getDomNode().getBoundingClientRect().top - 250
    );
    // Let document scroll listeners run before opening a new popup.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function openPopup(page, kind) {
  await page.mouse.move(0, 0);
  await page.evaluate((kind) => {
    const editor = window.editorRegression.editor;
    editor.setPosition(
      kind === 'suggest'
        ? { lineNumber: 2, column: 13 }
        : kind === 'hints'
        ? { lineNumber: 5, column: 11 }
        : { lineNumber: 15, column: 1 }
    );
    editor.focus();
    if (kind !== 'hover') {
      editor.trigger(
        'regression',
        kind === 'suggest'
          ? 'editor.action.triggerSuggest'
          : 'editor.action.triggerParameterHints',
        {}
      );
    }
  }, kind);
  if (kind === 'hover') {
    // Hover a different line from the cursor: hiding by cursor position is wrong.
    const point = await page.evaluate(() => {
      const editor = window.editorRegression.editor;
      const position = editor.getScrolledVisiblePosition({
        lineNumber: 1,
        column: 10,
      });
      const bounds = editor.getDomNode().getBoundingClientRect();
      return {
        x: bounds.left + position.left + 3,
        y: bounds.top + position.top + 12,
      };
    });
    await page.mouse.move(point.x, point.y);
  }
  await page.waitForFunction(
    ({ selector, text }) => {
      return [
        ...document.querySelectorAll(`[data-editor-overflow] ${selector}`),
      ].some((node) => {
        const style = getComputedStyle(node);
        const visible =
          style.visibility === 'visible' &&
          style.display !== 'none' &&
          node.getBoundingClientRect().height > 0 &&
          node.textContent.includes(text);
        if (visible)
          window.editorRegression.host = node.closest('[data-editor-overflow]');
        return visible;
      });
    },
    fixtures[kind],
    { timeout: 20_000 }
  );
}

async function assertClosed(page, kind, reason) {
  try {
    await page.waitForFunction(
      ({ selector }) => {
        return [
          ...window.editorRegression.host.querySelectorAll(selector),
        ].every((node) => {
          const style = getComputedStyle(node);
          return (
            style.visibility !== 'visible' ||
            style.display === 'none' ||
            node.getBoundingClientRect().height === 0
          );
        });
      },
      fixtures[kind],
      { timeout: 3000 }
    );
  } catch {
    assert.fail(`${kind} must close after ${reason}`);
  }
}

async function assertTypeScriptExamples(page) {
  const results = await page.evaluate(async () => {
    const { monaco, editor } = window.editorRegression;
    const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
    const diagnostics = async (model) => {
      // Synchronize the real model with Monaco's worker before every request,
      // including edits. Browser pageerror does not report TypeScript errors.
      const worker = await getWorker(model.uri);
      const uri = model.uri.toString();
      const errors = [
        ...(await worker.getSyntacticDiagnostics(uri)),
        ...(await worker.getSemanticDiagnostics(uri)),
      ];
      return errors.map(({ code, start, messageText }) => ({
        code,
        line: model.getPositionAt(start ?? 0).lineNumber,
        messageText,
      }));
    };
    const examples = await Promise.all(
      monaco.editor.getEditors().map(async (instance) => ({
        uri: instance.getModel().uri.toString(),
        diagnostics: await diagnostics(instance.getModel()),
      }))
    );
    const model = editor.getModel();
    const original = model.getValue();
    const source = [
      "import { Module, makeModule, type HKT, type ModuleLive, type TModule } from '@favy/di';",
      '',
      'type Box<Name, Result> = { value: Result; name: Name };',
      'interface BoxHKT extends HKT {',
      "  readonly type: TModule<this['_NAME'], this['_DEPS'], Box<this['_NAME'], this['_RESULT']>>;",
      '}',
      'const BoxModule = makeModule({',
      '  transformOutput: (value, deps) => ({',
      '    value,',
      '    name: (deps as unknown as ModuleLive).Module.name,',
      '  } as unknown as BoxHKT),',
      '});',
      "const Counter = BoxModule<{ start: number }>()('Counter', ({ start }) => start + 1);",
      'const box = Counter({ start: 1 });',
      'const inferredCount: number = box.value;',
      "const inferredName: 'Counter' = box.name;",
      "const Consumer = Module<typeof Counter.Live>()('Consumer', ({ Counter }) => Counter.value * 2);",
      'const composed: number = Consumer({ start: 1, Counter });',
      'const provided: number = Counter.provide({ start: 1 })().value;',
    ].join('\n');
    const invalidEdits = [];
    try {
      model.setValue(source);
      const valid = await diagnostics(model);
      for (const [from, to] of [
        ['Counter({ start: 1 })', "Counter({ start: 'wrong' })"],
        ['const inferredCount: number', 'const inferredCount: string'],
        ["const inferredName: 'Counter'", "const inferredName: 'Wrong'"],
        ['const composed: number', 'const composed: string'],
      ]) {
        const offset = source.indexOf(from);
        if (offset < 0)
          throw new Error(`Missing type regression fixture: ${from}`);
        model.setValue(source.replace(from, to));
        invalidEdits.push({
          edit: to,
          line: model.getPositionAt(offset).lineNumber,
          diagnostics: await diagnostics(model),
        });
      }
      model.setValue(source);
      return {
        examples,
        valid,
        invalidEdits,
        restored: await diagnostics(model),
      };
    } finally {
      model.setValue(original);
    }
  });

  assert.ok(
    results.examples.length > 0,
    'Real documentation examples must load'
  );
  for (const example of results.examples) {
    assert.deepEqual(
      example.diagnostics,
      [],
      `Documentation example ${example.uri} must type-check`
    );
  }
  assert.deepEqual(
    results.valid,
    [],
    'Module, Live and HKT must resolve and infer'
  );
  for (const edit of results.invalidEdits) {
    assert.deepEqual(
      edit.diagnostics.map(({ code, line }) => ({ code, line })),
      [{ code: 2322, line: edit.line }],
      `The editor must reject ${edit.edit}: ${JSON.stringify(edit.diagnostics)}`
    );
  }
  assert.deepEqual(
    results.restored,
    [],
    'Correcting an edit must clear diagnostics'
  );
}

const { browser, origin, close } = await startBrowserSession();

try {
  await assertEditorFiles(browser, origin);
  await assertEditorRun(browser, origin);
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: theme,
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const listeners = new Map([
          ['scroll', new Set()],
          ['resize', new Set()],
        ]);
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = (type, listener, options) => {
          listeners.get(type)?.add(listener);
          add(type, listener, options);
        };
        window.removeEventListener = (type, listener, options) => {
          listeners.get(type)?.delete(listener);
          remove(type, listener, options);
        };
        window.editorRegression = { listeners };
      });
      await page.goto(`${origin}/guides/introduction/`);
      for (const island of await page
        .locator('astro-island[component-export="Editor"]')
        .all()) {
        await island.locator('.inputarea').waitFor();
      }
      await page.evaluate(async (theme) => {
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
        if (!monaco) throw new Error('Monaco editor API export was not found');
        const editor = monaco.editor
          .getEditors()
          .sort(
            (a, b) =>
              a.getDomNode().getBoundingClientRect().top -
              b.getDomNode().getBoundingClientRect().top
          )[2];
        const island = editor.getDomNode().closest('astro-island');
        Object.assign(window.editorRegression, { monaco, editor, island });
      }, theme);
      await page.waitForFunction((theme) => {
        const themeClass = theme === 'dark' ? 'vs-dark' : 'vs';
        const { monaco } = window.editorRegression;
        return (
          monaco.editor
            .getEditors()
            .every((editor) =>
              editor.getDomNode().classList.contains(themeClass)
            ) &&
          [...document.querySelectorAll('[data-editor-overflow]')].every(
            (host) => host.classList.contains(themeClass)
          )
        );
      }, theme);
      await assertTypeScriptExamples(page);
      await page.evaluate(() => {
        const { editor } = window.editorRegression;
        editor.setValue(
          [
            'const reviewValue = { reviewMember: 1 };',
            'reviewValue.reviewMember;',
            '',
            'function reviewAdd(first: number, second: number) { return first + second; }',
            'reviewAdd(1, 2);',
            ...Array(20).fill('// Scroll regression fixture'),
          ].join('\n')
        );
      });

      await positionEditor(page);
      await page.waitForFunction(
        () => {
          const tokens = [
            ...window.editorRegression.editor
              .getDomNode()
              .querySelectorAll('.view-line span[class*="mtk"]'),
          ];
          const keyword = tokens.find(
            (node) => node.textContent.trim() === 'const'
          );
          const number = tokens.find((node) => node.textContent.trim() === '1');
          const comment = tokens.find((node) =>
            node.textContent
              .replaceAll('\u00a0', ' ')
              .includes('// Scroll regression fixture')
          );
          return (
            keyword &&
            number &&
            comment &&
            new Set(
              [keyword, number, comment].map(
                (node) => getComputedStyle(node).color
              )
            ).size === 3
          );
        },
        undefined,
        { timeout: 10_000 }
      );

      for (const kind of Object.keys(fixtures)) {
        await positionEditor(page);
        await openPopup(page, kind);
        await page.evaluate(() => window.scrollBy(0, 400));
        await assertClosed(
          page,
          kind,
          `partial editor scroll (${width}px ${theme})`
        );

        await positionEditor(page);
        await assertClosed(page, kind, 'scrolling back without reopening');
        await openPopup(page, kind);
        await page.evaluate(() => {
          const bounds = window.editorRegression.editor
            .getDomNode()
            .getBoundingClientRect();
          window.scrollBy(0, bounds.bottom + 100);
        });
        await assertClosed(page, kind, 'scrolling the whole editor offscreen');
        await positionEditor(page);
        await assertClosed(
          page,
          kind,
          'restoring the editor after a full scroll'
        );
        await openPopup(page, kind);
        await page.setViewportSize({ width, height: 860 });
        await assertClosed(page, kind, 'window resize');
        await page.setViewportSize({ width, height: 900 });
      }

      await positionEditor(page);
      const menuPoint = await page.evaluate(() => {
        const bounds = window.editorRegression.editor
          .getDomNode()
          .getBoundingClientRect();
        return { x: bounds.left + 80, y: bounds.top + 12 };
      });
      await page.mouse.click(menuPoint.x, menuPoint.y, { button: 'right' });
      await page.getByRole('menu').waitFor({ state: 'visible' });
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.getByRole('menu').waitFor({ state: 'hidden' });

      await positionEditor(page);
      await page.evaluate(() => {
        const editor = window.editorRegression.editor;
        editor.setPosition({
          lineNumber: 1,
          column: editor.getModel().getLineMaxColumn(1),
        });
        editor.focus();
      });
      await page.keyboard.type(' // typing still works');
      assert.ok(
        await page.evaluate(() =>
          window.editorRegression.editor
            .getValue()
            .includes('// typing still works')
        )
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() =>
          window.editorRegression.editor.hasTextFocus()
        ),
        false,
        'Tab must leave the editor'
      );

      const before = await page.evaluate(() => ({
        editors: window.editorRegression.monaco.editor.getEditors().length,
        hosts: document.querySelectorAll('[data-editor-overflow]').length,
        scroll: window.editorRegression.listeners.get('scroll').size,
        resize: window.editorRegression.listeners.get('resize').size,
      }));
      await page.evaluate(() =>
        window.editorRegression.island.dispatchEvent(
          new CustomEvent('astro:unmount')
        )
      );
      await page.waitForFunction(
        () => !window.editorRegression.host.isConnected
      );
      const after = await page.evaluate(() => ({
        editors: window.editorRegression.monaco.editor.getEditors().length,
        hosts: document.querySelectorAll('[data-editor-overflow]').length,
        scroll: window.editorRegression.listeners.get('scroll').size,
        resize: window.editorRegression.listeners.get('resize').size,
      }));
      for (const key of Object.keys(before)) {
        assert.equal(
          after[key],
          before[key] - 1,
          `Unmount must clean up ${key}`
        );
      }
      await page.evaluate(() => {
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
      });
      assert.deepEqual(
        errors,
        [],
        'Editor interactions must not raise browser errors'
      );
      console.log(`Editor regressions passed: ${width}px ${theme}`);
      await page.close();
    }
  }
} finally {
  await close();
}
