import { useEffect, useState } from 'react';
import MonacoEditor, {
  loader,
  type EditorProps,
  type OnMount,
} from '@monaco-editor/react';
import contextSource from '../../../di/src/lib/context.ts?raw';
import hktSource from '../../../di/src/lib/hkt.ts?raw';
import indexSource from '../../../di/src/index.ts?raw';
import makeModuleSource from '../../../di/src/lib/makeModule.ts?raw';
import moduleSource from '../../../di/src/lib/module.ts?raw';

const favyDiSources = [
  ['src/index.ts', indexSource],
  ['src/lib/context.ts', contextSource],
  ['src/lib/hkt.ts', hktSource],
  ['src/lib/makeModule.ts', makeModuleSource],
  ['src/lib/module.ts', moduleSource],
] as const;

const ambientTypes = `
declare module '@favy/di' {
  export * from "file:///node_modules/@favy/di/src/index.ts";
}

declare module '@jest/globals' {
  export const beforeEach: any;
  export const describe: any;
  export const expect: any;
  export const it: any;
}
`;

let monacoReady: Promise<void> | undefined;
let favyDiTypesLoaded = false;

const prepareMonaco = () => {
  monacoReady ??= Promise.all([
    import('monaco-editor/esm/vs/editor/editor.api'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    // The minimal editor API does not register these editing features.
    Promise.all([
      import('monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard'),
      import(
        'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu'
      ),
      import('monaco-editor/esm/vs/editor/contrib/find/browser/findController'),
      import(
        'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands'
      ),
      import(
        'monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch'
      ),
      import(
        'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution'
      ),
      import(
        'monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints'
      ),
      import(
        'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController'
      ),
      import(
        'monaco-editor/esm/vs/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode'
      ),
      import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
      import(
        'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
      ),
      // @ts-expect-error Monaco does not publish types for this controller.
      import('monaco-editor/esm/vs/editor/browser/config/tabFocus').then(
        ({
          TabFocus,
        }: {
          TabFocus: { setTabFocusMode(value: boolean): void };
        }) => {
          // Standalone Monaco reads this shared state for Tab keybindings.
          TabFocus.setTabFocusMode(true);
        }
      ),
    ]),
  ]).then(
    ([monaco, { default: EditorWorker }, { default: TypeScriptWorker }]) => {
      self.MonacoEnvironment = {
        getWorker(_moduleId: string, label: string) {
          return label === 'typescript' || label === 'javascript'
            ? new TypeScriptWorker()
            : new EditorWorker();
        },
      };
      loader.config({ monaco });
    }
  );

  return monacoReady;
};

type CodeEditorProps = { code: string } & Pick<
  EditorProps,
  | 'path'
  | 'height'
  | 'beforeMount'
  | 'onMount'
  | 'keepCurrentModel'
  | 'saveViewState'
>;

export function CodeEditor({
  code,
  height = code.split('\n').length * 27,
  onMount,
  ...modelOptions
}: CodeEditorProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [overflowWidgetsDomNode, setOverflowWidgetsDomNode] =
    useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Keep popups outside the content pane's isolated stacking context.
    const overflowHost = document.createElement('div');
    overflowHost.dataset.editorOverflow = '';
    Object.assign(overflowHost.style, {
      position: 'fixed',
      top: '0px',
      left: '0px',
      width: '0px',
      height: '0px',
      zIndex: 'calc(var(--sl-z-index-navbar) + 1)',
    });
    document.body.append(overflowHost);

    void prepareMonaco()
      .then(() => {
        if (!cancelled) setOverflowWidgetsDomNode(overflowHost);
      })
      .catch(() => {
        // Keep the server-rendered code block when the editor cannot initialize.
      });

    const handleThemeChange = () => {
      const isDark =
        document.documentElement.getAttribute('data-theme') === 'dark';
      overflowHost.className = `monaco-editor ${isDark ? 'vs-dark' : 'vs'}`;
      setIsDarkMode(isDark);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-theme'
        ) {
          handleThemeChange();
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    handleThemeChange();
    return () => {
      cancelled = true;
      observer.disconnect();
      overflowHost.remove();
    };
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editor.updateOptions({
      ariaLabel: 'Editable TypeScript example',
      fontSize: 16,
      fixedOverflowWidgets: true,
      hover: { above: false },
      minimap: { enabled: false },
      lineNumbers: 'off',
    });

    const closeOverflowWidgets = () => {
      // Dismiss transient popups when their document coordinates change. The
      // editor can remain visible while the popup's source line moves offscreen.
      editor.trigger('document-layout', 'hideSuggestWidget', {});
      editor.trigger('document-layout', 'closeParameterHints', {});
      // Monaco 0.52 exposes no hide-hover command. Keep its controller-specific
      // method here; browser regressions cover this integration on upgrades.
      editor
        .getContribution<{
          dispose(): void;
          _hideWidgets(): void;
        }>('editor.contrib.contentHover')
        ?._hideWidgets();
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        overflowWidgetsDomNode?.contains(activeElement)
      ) {
        // Monaco's context menu closes on blur inside its shadow root.
        const focusedMenuElement = activeElement.shadowRoot?.activeElement;
        if (focusedMenuElement instanceof HTMLElement)
          focusedMenuElement.blur();
      }
    };
    // Do not capture scroll events from the editor or its popup lists.
    window.addEventListener('scroll', closeOverflowWidgets, { passive: true });
    window.addEventListener('resize', closeOverflowWidgets);
    editor.onDidDispose(() => {
      window.removeEventListener('scroll', closeOverflowWidgets);
      window.removeEventListener('resize', closeOverflowWidgets);
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      diagnosticCodesToIgnore: [2589],
      // Switching files must revalidate the new tab against edited imports.
      onlyVisible: true,
    });
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
      strict: true,
      strictFunctionTypes: true,
    });

    if (!favyDiTypesLoaded) {
      for (const [file, source] of favyDiSources) {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          source,
          `file:///node_modules/@favy/di/${file}`
        );
      }
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        ambientTypes,
        'file:///node_modules/@favy/di/ambient.d.ts'
      );
      favyDiTypesLoaded = true;
    }
    onMount?.(editor, monaco);
  };

  if (!overflowWidgetsDomNode) {
    return (
      <pre
        aria-label="TypeScript example"
        style={{ maxWidth: '100%', overflowX: 'auto' }}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <MonacoEditor
      {...modelOptions}
      height={height}
      defaultLanguage="typescript"
      theme={isDarkMode ? 'vs-dark' : 'vs'}
      defaultValue={code}
      options={{ overflowWidgetsDomNode }}
      loading={
        <pre
          aria-label="TypeScript example"
          style={{ maxWidth: '100%', overflowX: 'auto' }}
        >
          <code>{code}</code>
        </pre>
      }
      onMount={handleEditorDidMount}
    />
  );
}
