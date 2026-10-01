import { useEffect, useId, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { CodeEditor } from './code-editor';
import { useExampleRunner } from './example-runner';
import './editor-files.css';

export type ExampleFile = { name: string; code: string };

export function EditorFiles({
  files,
  entry,
}: {
  files: readonly [ExampleFile, ...ExampleFile[]];
  entry?: string;
}) {
  const projectId = useId();
  const pathFor = (name: string) =>
    `file:///examples/${encodeURIComponent(projectId)}/${name}`;
  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeName, setActiveName] = useState(files[0].name);
  const instance = useRef<editor.IStandaloneCodeEditor>();
  const models = useRef(new Map<string, editor.ITextModel>());
  const viewStates = useRef(new Map<string, editor.ICodeEditorViewState>());
  const opener = useRef<IDisposable>();
  const monacoApi = useRef<Monaco>();
  const runner = useExampleRunner({
    entry,
    monaco: monacoApi.current,
    models: models.current,
  });
  const activeFile = files.find((file) => file.name === activeName)!;
  // Keep the page still when switching files; long files scroll inside Monaco.
  const height = Math.min(
    600,
    Math.max(
      240,
      ...files.map((file) => file.code.split('\n').length * 24 + 24)
    )
  );

  useEffect(() => {
    setHydrated(true);
    return () => {
      opener.current?.dispose();
      instance.current?.setModel(null);
      for (const model of models.current.values()) model.dispose();
      models.current.clear();
      viewStates.current.clear();
    };
  }, []);

  const activateModel = (name: string) => {
    const codeEditor = instance.current;
    const model = models.current.get(name);
    if (!codeEditor || !model) return;

    const previous = codeEditor.getModel();
    if (previous !== model) {
      // Tab focus leaves Monaco's previous F12 result cycle active otherwise.
      codeEditor.trigger(
        'file-tab',
        'editor.gotoNextSymbolFromResult.cancel',
        {}
      );
      const state = codeEditor.saveViewState();
      if (previous && state)
        viewStates.current.set(previous.uri.toString(), state);
      codeEditor.setModel(model);
      const saved = viewStates.current.get(model.uri.toString());
      if (saved) codeEditor.restoreViewState(saved);
    }
  };

  useEffect(() => {
    if (ready) activateModel(activeName);
  }, [activeName, ready]);

  const beforeMount: BeforeMount = (monaco) => {
    for (const file of files) {
      models.current.set(
        file.name,
        monaco.editor.createModel(
          file.code,
          'typescript',
          monaco.Uri.parse(pathFor(file.name))
        )
      );
    }
    // Include unopened files when Monaco starts or restarts its TS worker.
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  };

  const onMount: OnMount = (codeEditor, monaco) => {
    instance.current = codeEditor;
    monacoApi.current = monaco;
    // Callable modules can have both a declaration and a generic call signature.
    codeEditor.updateOptions({ gotoLocation: { multipleDefinitions: 'goto' } });
    opener.current = monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, selection) {
        if (
          source !== codeEditor ||
          codeEditor.getModel()?.uri.toString() === resource.toString()
        )
          return false;
        const file = files.find(
          ({ name }) =>
            models.current.get(name)?.uri.toString() === resource.toString()
        );
        if (!file) return false;
        // Monaco expects the target model to be attached when this returns.
        activateModel(file.name);
        setActiveName(file.name);
        if (selection) {
          if ('startLineNumber' in selection) {
            codeEditor.setSelection(selection);
            codeEditor.revealRangeInCenter(selection);
          } else {
            codeEditor.setPosition(selection);
            codeEditor.revealPositionInCenter(selection);
          }
        }
        codeEditor.focus();
        return true;
      },
    });
    setReady(true);
  };

  if (!hydrated) {
    return (
      <div className="editor-files-fallback not-content">
        {files.map((file, index) => (
          <details key={file.name} open={index === 0}>
            <summary>{file.name}</summary>
            <pre aria-label={`TypeScript example: ${file.name}`}>
              <code>{file.code}</code>
            </pre>
          </details>
        ))}
      </div>
    );
  }

  return (
    <Tabs.Root
      className="editor-files not-content"
      value={activeName}
      onValueChange={setActiveName}
    >
      <div className="editor-file-toolbar">
        <Tabs.List className="editor-file-tabs" aria-label="Example files">
          {files.map((file) => (
            <Tabs.Trigger
              key={file.name}
              className="editor-file-tab"
              value={file.name}
            >
              {file.name}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {runner.controls}
      </div>
      <Tabs.Content value={activeName} tabIndex={-1}>
        <CodeEditor
          code={activeFile.code}
          path={pathFor(files[0].name)}
          height={height}
          beforeMount={beforeMount}
          onMount={onMount}
          keepCurrentModel
          saveViewState={false}
        />
      </Tabs.Content>
      {runner.output}
    </Tabs.Root>
  );
}
