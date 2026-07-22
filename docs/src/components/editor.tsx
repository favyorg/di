import { useEffect, useState } from 'react';
// @ts-ignore
import MonacoEditor, { loader } from '@monaco-editor/react';
import hktSource from '../../../di/src/lib/hkt.ts?raw';
import indexSource from '../../../di/src/index.ts?raw';
import makeModuleSource from '../../../di/src/lib/makeModule.ts?raw';
import moduleSource from '../../../di/src/lib/module.ts?raw';

const favyDiSources = [
  ['src/index.ts', indexSource],
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

const prepareMonaco = () => {
  monacoReady ??= Promise.all([
    import('monaco-editor/esm/vs/editor/editor.api'),
    import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
  ]).then(
    ([monaco, , { default: EditorWorker }, { default: TypeScriptWorker }]) => {
      (self as any).MonacoEnvironment = {
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

export function Editor({ code }: { code: string }) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void prepareMonaco()
      .then(() => {
        if (!cancelled) setIsClient(true);
      })
      .catch(() => {
        // Keep the server-rendered code block when the editor cannot initialize.
      });

    const handleThemeChange = () => {
      setIsDarkMode(
        document.documentElement.getAttribute('data-theme') === 'dark'
      );
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
    };
  }, []);

  function handleEditorDidMount(editor: any, monaco: any) {
    editor.updateOptions({
      fontSize: 16,
      minimap: { enabled: false },
      lineNumbers: 'off',
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      diagnosticCodesToIgnore: [2589],
    });
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
      strict: true,
      strictFunctionTypes: true,
    });

    if (!(window as any).__favyDiTypesLoaded) {
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
      (window as any).__favyDiTypesLoaded = true;
    }
  }

  if (!isClient) {
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
      height={code.split('\n').length * 27}
      defaultLanguage="typescript"
      theme={isDarkMode ? 'vs-dark' : 'vs'}
      defaultValue={code}
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
