import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import MonacoEditor from '@monaco-editor/react';

export function Editor({ code }: { code: string }) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
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
    return () => observer.disconnect();
  }, []);

  // @ts-ignore
  async function handleEditorDidMount(editor, monaco) {
    editor.updateOptions({
      fontSize: 16,
      minimap: { enabled: false },
      lineNumbers: 'off',
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      diagnosticCodesToIgnore: [2589],
    });

    const files = await fetch(
      'https://data.jsdelivr.com/v1/packages/npm/@favy/di@3.0.0?structure=flat'
    )
      .then((d) => d.json())
      .then(({ files }) => {
        return files
          .map((f: any) => f.name)
          .filter((f: string) => f.endsWith('.ts'));
      });

    Promise.allSettled(
      files.map(async (f: string) => {
        const typeDefs =
          // @ts-ignore
          window.moduleLoadCache?.[f] ??
          (await fetch(`https://cdn.jsdelivr.net/npm/@favy/di${f}`).then((r) =>
            r.text()
          ));

        // @ts-ignore
        window.moduleLoadCache ||= {};
        // @ts-ignore
        window.moduleLoadCache[f] = typeDefs;

        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          typeDefs,
          `file:///node_modules/@favy/di${f}`
        );
      })
    )
      .catch(console.error)
      .then(() => {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          `
          declare module '@favy/di' {
            export * from "file:///node_modules/@favy/di/src/index.ts";
            export * from "file:///node_modules/@favy/di/src/lib/hkt.ts";
          }
          `,
          `file:///node_modules/@favy/di/_declare_favy_di.d.ts`
        );
      });
  }

  return (
    <MonacoEditor
      height={code.split('\n').length * 27}
      defaultLanguage="typescript"
      theme={isDarkMode ? 'vs-dark' : 'vs'}
      defaultValue={code}
      onMount={handleEditorDidMount}
    />
  );
}
