import assert from 'node:assert/strict';

const names = [
  'api-module.ts',
  'api-types.ts',
  'loaders.ts',
  'main.ts',
  'app.ts',
];
const route = '/module/transform-output/#return-typed-api-results';

async function selectFile(page, name) {
  await page
    .locator('.editor-files')
    .getByRole('tab', { name, exact: true })
    .click();
  await assertActiveFile(page, name);
}

async function assertActiveFile(page, name) {
  await page.waitForFunction((name) => {
    const { editor, widget } = window.fileRegression;
    return (
      widget.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent === name &&
      editor.getModel()?.uri.path.endsWith(`/${name}`)
    );
  }, name);
  assert.deepEqual(
    await page.evaluate(() => {
      const { monaco, editor, widget, editorIds } = window.fileRegression;
      return {
        sameInstances:
          JSON.stringify(
            monaco.editor.getEditors().map((entry) => entry.getId())
          ) === JSON.stringify(editorIds),
        widgetEditors: widget.querySelectorAll('.monaco-editor').length,
        sameEditor: widget.contains(editor.getDomNode()),
      };
    }),
    { sameInstances: true, widgetEditors: 1, sameEditor: true },
    'Switching files must reuse one Monaco editor'
  );
}

async function diagnostics(page) {
  return page.evaluate(async () => {
    const { monaco, editor, models } = window.fileRegression;
    const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
    // Only request the active file: the widget must also synchronize unopened
    // files itself, otherwise their imports silently resolve as any.
    const worker = await getWorker(editor.getModel().uri);
    return Promise.all(
      models.map(async (model) => {
        const uri = model.uri.toString();
        const errors = [
          ...(await worker.getSyntacticDiagnostics(uri)),
          ...(await worker.getSemanticDiagnostics(uri)),
        ];
        return {
          name: model.uri.path.split('/').at(-1),
          errors: errors.map(({ code, messageText }) => ({
            code,
            messageText,
          })),
        };
      })
    );
  });
}

async function assertVisibleErrors(page, codes) {
  await page.waitForFunction(
    (expected) => {
      const { monaco, editor } = window.fileRegression;
      const actual = monaco.editor
        .getModelMarkers({ resource: editor.getModel().uri })
        .filter(({ severity }) => severity === monaco.MarkerSeverity.Error)
        .map(({ code }) =>
          Number(typeof code === 'object' ? code.value : code)
        );
      return JSON.stringify(actual) === JSON.stringify(expected);
    },
    codes,
    { timeout: 10_000 }
  );
}

export async function assertEditorFiles(browser, origin) {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: theme,
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${origin}${route}`);
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
          if (!monaco)
            throw new Error('Monaco editor API export was not found');
          const widget = document.querySelector('.editor-files');
          const editor = monaco.editor
            .getEditors()
            .find((entry) => widget.contains(entry.getDomNode()));
          const base = editor
            .getModel()
            .uri.toString()
            .replace(/[^/]+$/, '');
          window.fileRegression = {
            monaco,
            editor,
            widget,
            island: widget.closest('astro-island'),
            models: monaco.editor
              .getModels()
              .filter((model) => model.uri.toString().startsWith(base)),
            editorIds: monaco.editor.getEditors().map((entry) => entry.getId()),
          };
        }, theme);
        await page.waitForFunction(
          (theme) =>
            window.fileRegression.editor
              .getDomNode()
              .classList.contains(theme === 'dark' ? 'vs-dark' : 'vs'),
          theme
        );
        const tabs = page.locator('.editor-files').getByRole('tab');
        assert.deepEqual(
          await tabs.allTextContents(),
          names,
          'All file tabs must have accessible names'
        );
        assert.equal(
          await page
            .locator('.editor-files')
            .getByRole('tablist', { name: 'Example files' })
            .count(),
          1
        );
        await assertActiveFile(page, names[0]);
        assert.equal(
          await page.evaluate(() => window.fileRegression.models.length),
          names.length
        );
        assert.deepEqual(
          await diagnostics(page),
          names.map((name) => ({ name, errors: [] })),
          'Unopened files must resolve and type-check'
        );

        await selectFile(page, 'api-types.ts');
        await page.evaluate(() => {
          const { editor } = window.fileRegression;
          const model = editor.getModel();
          const match = model.findMatches(
            'name: string',
            false,
            false,
            false,
            null,
            false
          )[0];
          if (!match) throw new Error('Missing User.name fixture');
          editor.pushUndoStop();
          editor.executeEdits('regression', [
            { range: match.range, text: 'name: number' },
          ]);
          editor.pushUndoStop();
        });
        const changed = await diagnostics(page);
        assert.deepEqual(
          changed
            .filter(({ name }) => name !== 'app.ts')
            .map(({ errors }) => errors),
          names.filter((name) => name !== 'app.ts').map(() => [])
        );
        assert.deepEqual(
          changed
            .find(({ name }) => name === 'app.ts')
            .errors.map(({ code }) => code),
          [2322],
          'Editing a dependency must update diagnostics in another file'
        );
        await selectFile(page, 'app.ts');
        await assertVisibleErrors(page, [2322]);
        await selectFile(page, 'api-types.ts');
        await page.evaluate(() =>
          window.fileRegression.editor.trigger('regression', 'undo', null)
        );
        assert.deepEqual(
          await diagnostics(page),
          names.map((name) => ({ name, errors: [] })),
          'Undoing the dependency edit must clear cross-file diagnostics'
        );

        await selectFile(page, 'app.ts');
        await assertVisibleErrors(page, []);
        await selectFile(page, 'api-module.ts');
        const original = await page.evaluate(() => {
          const { editor } = window.fileRegression;
          editor.setPosition({ lineNumber: 1, column: 1 });
          editor.pushUndoStop();
          editor.focus();
          return editor.getValue();
        });
        await page.keyboard.press('Enter');
        const state = await page.evaluate(() => {
          const { editor } = window.fileRegression;
          editor.pushUndoStop();
          editor.setSelection({
            startLineNumber: 20,
            startColumn: 2,
            endLineNumber: 20,
            endColumn: 6,
          });
          editor.setScrollTop(120);
          return {
            selection: editor.getSelection(),
            scrollTop: editor.getScrollTop(),
          };
        });
        assert.ok(
          state.scrollTop > 0,
          'View-state fixture must scroll inside the editor'
        );
        await selectFile(page, 'app.ts');
        await selectFile(page, 'api-module.ts');
        const restored = await page.evaluate(() => {
          const { editor } = window.fileRegression;
          return {
            value: editor.getValue(),
            selection: editor.getSelection(),
            scrollTop: editor.getScrollTop(),
          };
        });
        assert.equal(
          restored.value,
          `\n${original}`,
          'File edits must survive tab changes'
        );
        assert.deepEqual(
          restored.selection,
          state.selection,
          'Selection must survive tab changes'
        );
        assert.ok(
          Math.abs(restored.scrollTop - state.scrollTop) <= 1,
          'Scroll position must survive tab changes'
        );
        await page.evaluate(() =>
          window.fileRegression.editor.trigger('regression', 'undo', null)
        );
        assert.equal(
          await page.evaluate(() => window.fileRegression.editor.getValue()),
          original,
          'Undo history must survive tab changes'
        );

        const firstTab = page
          .locator('.editor-files')
          .getByRole('tab', { name: 'api-module.ts', exact: true });
        await firstTab.focus();
        await page.keyboard.press('ArrowRight');
        await assertActiveFile(page, 'api-types.ts');
        await page.keyboard.press('End');
        await assertActiveFile(page, 'app.ts');
        await page.keyboard.press('Home');
        await assertActiveFile(page, 'api-module.ts');
        await page.keyboard.press('ArrowLeft');
        await assertActiveFile(page, 'app.ts');

        for (const symbol of ['User', 'Orders']) {
          await selectFile(page, 'app.ts');
          await page.evaluate((symbol) => {
            const { editor } = window.fileRegression;
            const match = editor
              .getModel()
              .findMatches(symbol, false, false, false, null, false)[0];
            if (!match)
              throw new Error(`Missing definition fixture: ${symbol}`);
            editor.setPosition({
              lineNumber: match.range.startLineNumber,
              column: match.range.startColumn + 2,
            });
            editor.focus();
          }, symbol);
          await page.keyboard.press('F12');
          await assertActiveFile(page, 'loaders.ts');
          assert.ok(
            await page.evaluate((symbol) => {
              const { editor } = window.fileRegression;
              return editor
                .getModel()
                .getLineContent(editor.getPosition().lineNumber)
                .includes(`export const ${symbol}`);
            }, symbol),
            `Go to definition from ${symbol} must select the exported loader in its file`
          );
        }

        for (const [name, reference, offset] of [
          ['app.ts', 'Main({ api, User, Orders })', 2],
          ['main.ts', 'typeof Main.Live', 9],
        ]) {
          await selectFile(page, name);
          await page.evaluate(
            ({ reference, offset }) => {
              const { editor } = window.fileRegression;
              const match = editor
                .getModel()
                .findMatches(reference, false, false, false, null, false)[0];
              if (!match) throw new Error('Missing Main definition fixture');
              editor.setPosition({
                lineNumber: match.range.startLineNumber,
                column: match.range.startColumn + offset,
              });
              editor.focus();
            },
            { reference, offset }
          );
          // End the previous definition cycle before navigating a new reference.
          await page.keyboard.press('Escape');
          await page.keyboard.press('F12');
          await assertActiveFile(page, 'main.ts');
          await page.waitForFunction(() => {
            const { editor } = window.fileRegression;
            return editor
              .getModel()
              .getLineContent(editor.getPosition().lineNumber)
              .includes('export const Main = Module');
          });
        }

        await page.evaluate(() =>
          window.fileRegression.island.dispatchEvent(
            new CustomEvent('astro:unmount')
          )
        );
        await page.waitForFunction(() => {
          const { monaco, models, editor } = window.fileRegression;
          return (
            models.every((model) => model.isDisposed()) &&
            !monaco.editor.getEditors().includes(editor)
          );
        });
        assert.deepEqual(
          errors,
          [],
          'Tabbed editor interactions must not raise browser errors'
        );
        console.log(`Tabbed editor regressions passed: ${width}px ${theme}`);
      } finally {
        await page.close();
      }

      const fallback = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: theme,
        javaScriptEnabled: false,
      });
      try {
        await fallback.goto(`${origin}${route}`);
        const files = fallback.locator('.editor-files-fallback details');
        assert.deepEqual(
          await files.locator('summary').allTextContents(),
          names,
          'The no-JavaScript fallback must expose every file'
        );
        for (const [index, source] of [
          'export const ApiModule',
          'export type Api',
          'export const User',
          'export const Main',
          'Main({ api, User, Orders })',
        ].entries()) {
          const file = files.nth(index);
          if ((await file.getAttribute('open')) === null)
            await file.locator('summary').click();
          await file.locator('pre').waitFor({ state: 'visible' });
          assert.ok(
            (await file.locator('code').textContent()).includes(source)
          );
        }
      } finally {
        await fallback.close();
      }
    }
  }
}
