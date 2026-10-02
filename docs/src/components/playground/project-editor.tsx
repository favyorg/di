import { useEffect, useId, useRef } from 'react';
import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { CodeEditor } from '../code-editor';

export type ProjectEditorRuntime = {
  monaco: Monaco;
  models: ReadonlyMap<string, editor.ITextModel>;
};

export type ProjectEditorProps = {
  projectId: string;
  files: Readonly<Record<string, string>>;
  activeFile: string;
  onChange(path: string, code: string): void;
  onSelect(path: string): void;
  onReady(runtime: ProjectEditorRuntime): void;
};

const languageFor = (path: string): string => {
  if (/\.[cm]?tsx?$/i.test(path)) return 'typescript';
  if (/\.[cm]?jsx?$/i.test(path)) return 'javascript';
  if (/\.css$/i.test(path)) return 'css';
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.json$/i.test(path)) return 'json';
  return 'plaintext';
};

export function ProjectEditor(props: ProjectEditorProps) {
  const instanceId = useId();
  const latest = useRef(props);
  latest.current = props;
  const root = useRef(
    `file:///projects/${encodeURIComponent(
      props.projectId
    )}/${encodeURIComponent(instanceId)}`
  );
  const pathFor = (path: string) =>
    `${root.current}${path.split('/').map(encodeURIComponent).join('/')}`;
  // Model switching is managed below, keeping Monaco's own path effect idle.
  const initialPath = useRef(pathFor(props.activeFile));
  const instance = useRef<editor.IStandaloneCodeEditor>();
  const monacoApi = useRef<Monaco>();
  const models = useRef(new Map<string, editor.ITextModel>());
  const changes = useRef(new Map<string, IDisposable>());
  const viewStates = useRef(new Map<string, editor.ICodeEditorViewState>());
  const updating = useRef(new Set<string>());
  const opener = useRef<IDisposable>();

  const activate = (path: string) => {
    const codeEditor = instance.current;
    const model = models.current.get(path);
    if (!codeEditor || !model) return;

    const previous = codeEditor.getModel();
    if (previous !== model) {
      codeEditor.trigger(
        'file-tree',
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
    codeEditor.updateOptions({ ariaLabel: `Project file: ${path}` });
  };

  const syncModels = (monaco: Monaco) => {
    const files = latest.current.files;
    for (const [path, model] of models.current) {
      if (Object.hasOwn(files, path)) continue;
      if (instance.current?.getModel() === model)
        instance.current.setModel(null);
      changes.current.get(path)?.dispose();
      changes.current.delete(path);
      viewStates.current.delete(model.uri.toString());
      model.dispose();
      models.current.delete(path);
    }
    for (const [path, code] of Object.entries(files)) {
      const existing = models.current.get(path);
      if (existing) {
        if (existing.getValue() !== code) {
          updating.current.add(path);
          try {
            existing.setValue(code);
          } finally {
            updating.current.delete(path);
          }
        }
        continue;
      }
      const model = monaco.editor.createModel(
        code,
        languageFor(path),
        monaco.Uri.parse(pathFor(path))
      );
      models.current.set(path, model);
      changes.current.set(
        path,
        model.onDidChangeContent(() => {
          if (!updating.current.has(path)) {
            latest.current.onChange(path, model.getValue());
          }
        })
      );
    }
  };

  useEffect(() => {
    const monaco = monacoApi.current;
    if (!monaco) return;
    syncModels(monaco);
    activate(props.activeFile);
  }, [props.files, props.activeFile]);

  useEffect(
    () => () => {
      opener.current?.dispose();
      instance.current?.setModel(null);
      for (const subscription of changes.current.values())
        subscription.dispose();
      for (const model of models.current.values()) model.dispose();
      changes.current.clear();
      models.current.clear();
      viewStates.current.clear();
      instance.current = undefined;
      monacoApi.current = undefined;
    },
    []
  );

  const beforeMount: BeforeMount = (monaco) => {
    syncModels(monaco);
    // Imported files are available to the worker before their first selection.
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  };

  const onMount: OnMount = (codeEditor, monaco) => {
    instance.current = codeEditor;
    monacoApi.current = monaco;
    codeEditor.updateOptions({
      automaticLayout: true,
      fontSize: 14,
      lineNumbers: 'on',
      wordWrap: 'on',
      wrappingIndent: 'indent',
      scrollBeyondLastLine: false,
      tabSize: 2,
      gotoLocation: { multipleDefinitions: 'goto' },
    });
    syncModels(monaco);
    activate(latest.current.activeFile);
    opener.current = monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, selection) {
        if (source !== codeEditor) return false;
        const target = [...models.current].find(
          ([, model]) => model.uri.toString() === resource.toString()
        );
        if (!target) return false;
        const [path] = target;
        // Monaco expects its destination model before the opener returns.
        activate(path);
        latest.current.onSelect(path);
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
    latest.current.onReady({ monaco, models: models.current });
  };

  return (
    <CodeEditor
      code={props.files[props.activeFile] ?? ''}
      path={initialPath.current}
      height="100%"
      beforeMount={beforeMount}
      onMount={onMount}
      keepCurrentModel
      saveViewState={false}
    />
  );
}
