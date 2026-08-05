import MonacoEditor, {
  loader,
  type Monaco,
  type OnMount,
} from '@monaco-editor/react';
import {
  forwardRef,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { favyDiSourceFiles } from './playground/favy-di-sources';
import {
  createAutoTypingsGeneration,
  type AutoTypingsGeneration,
} from './typescript-editor-typings';

const ambientTypes = `
declare module '@jest/globals' {
  export const beforeEach: any;
  export const describe: any;
  export const expect: any;
  export const it: any;
}
`;

let typeScriptConfigured = false;

const configureTypeScript = (monaco: Monaco): void => {
  if (typeScriptConfigured) return;

  const defaults = monaco.languages.typescript.typescriptDefaults;
  defaults.setDiagnosticsOptions({
    diagnosticCodesToIgnore: [2589],
  });
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    strict: true,
    strictFunctionTypes: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowSyntheticDefaultImports: true,
    noEmit: true,
  });

  for (const { packagePath, code } of favyDiSourceFiles) {
    defaults.addExtraLib(code, `file:///node_modules/@favy/di/${packagePath}`);
  }
  defaults.addExtraLib(
    '{"types":"src/index.ts"}',
    'file:///node_modules/@favy/di/package.json'
  );
  defaults.addExtraLib(
    ambientTypes,
    'file:///node_modules/@favy/di/ambient.d.ts'
  );
  typeScriptConfigured = true;
};

let monacoReady: Promise<void> | undefined;

const prepareMonaco = (): Promise<void> => {
  monacoReady ??= Promise.all([
    import('monaco-editor/esm/vs/editor/editor.api'),
    import(
      'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
    ),
    import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
  ]).then(
    async ([
      monaco,
      ,
      ,
      { default: EditorWorker },
      { default: TypeScriptWorker },
    ]) => {
      await import(
        'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution'
      );
      self.MonacoEnvironment = {
        getWorker(_moduleId: string, label: string) {
          return label === 'typescript' || label === 'javascript'
            ? new TypeScriptWorker()
            : new EditorWorker();
        },
      };
      loader.config({ monaco });
      configureTypeScript(monaco);
    }
  );

  return monacoReady;
};

type MountedEditor = Parameters<OnMount>[0];
type AutoTypingsModule =
  typeof import('monaco-editor-auto-typings/custom-editor');
type AutoTypingsCache = InstanceType<AutoTypingsModule['LocalStorageCache']>;

type ActiveAutoTypingsGeneration = Readonly<{
  editor: MountedEditor;
  signature: string;
  generation: AutoTypingsGeneration;
}>;

let sharedLocalStorageCache: AutoTypingsCache | undefined;

export type TypeScriptEditorSnapshot = Readonly<{
  hadFocus: boolean;
  anchor: number;
  head: number;
}>;

export type TypeScriptEditorHandle = {
  readValue(): string;
  capture(): TypeScriptEditorSnapshot | undefined;
  restore(snapshot: TypeScriptEditorSnapshot): void;
};

export type TypeScriptEditorProps = Readonly<{
  value: string;
  onChange?(value: string): void;
  height: number | string;
  modelPath: string;
  ariaLabel: string;
  fallback: ReactNode;
  readOnly?: boolean;
  onReady?(): void;
  typingVersions?: Readonly<Record<string, string>>;
}>;

const canonicalTypingVersions = (
  versions: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> | undefined =>
  versions === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(versions).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );

const restoreEditorSnapshot = (
  editor: MountedEditor | undefined,
  monaco: Monaco | undefined,
  snapshot: TypeScriptEditorSnapshot
): boolean => {
  const model = editor?.getModel();
  if (!editor || !monaco || !model) return false;

  const clamp = (offset: number) =>
    Math.min(model.getValueLength(), Math.max(0, offset));
  const anchor = model.getPositionAt(clamp(snapshot.anchor));
  const head = model.getPositionAt(clamp(snapshot.head));
  editor.setSelection(
    new monaco.Selection(
      anchor.lineNumber,
      anchor.column,
      head.lineNumber,
      head.column
    )
  );
  if (snapshot.hadFocus) editor.focus();
  return true;
};

const TypeScriptEditorComponent = forwardRef<
  TypeScriptEditorHandle,
  TypeScriptEditorProps
>(function TypeScriptEditor(
  {
    value,
    onChange,
    height,
    modelPath,
    ariaLabel,
    fallback,
    readOnly = false,
    onReady,
    typingVersions,
  },
  ref
) {
  const editorRef = useRef<MountedEditor>();
  const monacoRef = useRef<Monaco>();
  const pendingRestoreRef = useRef<TypeScriptEditorSnapshot>();
  const activeAutoTypesRef = useRef<ActiveAutoTypingsGeneration>();
  const autoTypesRequestRef = useRef(0);
  const sortedTypingVersions = canonicalTypingVersions(typingVersions);
  const typingVersionsSignature =
    sortedTypingVersions === undefined
      ? undefined
      : JSON.stringify(sortedTypingVersions);
  const typingVersionsRef = useRef(sortedTypingVersions);
  const typingVersionsSignatureRef = useRef(typingVersionsSignature);
  const valueRef = useRef(value);
  const [isReady, setIsReady] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  valueRef.current = value;
  typingVersionsRef.current = sortedTypingVersions;
  typingVersionsSignatureRef.current = typingVersionsSignature;

  const synchronizeAutoTypings = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const signature = typingVersionsSignatureRef.current;
    const current = activeAutoTypesRef.current;

    if (
      current &&
      current.editor === editor &&
      current.signature === signature
    ) {
      return;
    }

    const request = ++autoTypesRequestRef.current;
    current?.generation.invalidate();
    activeAutoTypesRef.current = undefined;
    const versions = typingVersionsRef.current;
    if (!editor || !monaco || signature === undefined || !versions) return;

    void (async () => {
      try {
        const { AutoTypings, LocalStorageCache } = await import(
          'monaco-editor-auto-typings/custom-editor'
        );
        if (
          autoTypesRequestRef.current !== request ||
          editorRef.current !== editor ||
          monacoRef.current !== monaco ||
          typingVersionsSignatureRef.current !== signature
        ) {
          return;
        }

        sharedLocalStorageCache ??= new LocalStorageCache();
        const generation = createAutoTypingsGeneration({
          monaco,
          sourceCache: sharedLocalStorageCache,
        });
        activeAutoTypesRef.current = { editor, signature, generation };
        const autoTypes = await AutoTypings.create(editor, {
          monaco: generation.monaco,
          versions: { ...versions },
          onlySpecifiedPackages: true,
          preloadPackages: true,
          shareCache: false,
          sourceCache: generation.sourceCache,
          sourceResolver: generation.sourceResolver,
          debounceDuration: 0,
          fileRootPath: 'file:///',
          dontAdaptEditorOptions: true,
          dontRefreshModelValueAfterResolvement: true,
          onError: () => {},
        });
        autoTypes.dispose();
      } catch {
        // Type acquisition must never block editing or playground runtime.
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const updateTheme = () => {
      setIsDarkMode(
        document.documentElement.getAttribute('data-theme') === 'dark'
      );
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    updateTheme();

    void prepareMonaco()
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch(() => {
        // Keep the server-rendered fallback when Monaco cannot initialize.
      });

    return () => {
      cancelled = true;
      autoTypesRequestRef.current += 1;
      activeAutoTypesRef.current?.generation.invalidate();
      activeAutoTypesRef.current = undefined;
      editorRef.current = undefined;
      monacoRef.current = undefined;
      pendingRestoreRef.current = undefined;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    synchronizeAutoTypings();
  }, [synchronizeAutoTypings, typingVersionsSignature]);

  useImperativeHandle(
    ref,
    () => ({
      readValue: () => editorRef.current?.getValue() ?? valueRef.current,
      capture: () => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        const selection = editor?.getSelection();
        if (!editor || !model || !selection) return undefined;

        return {
          hadFocus: editor.hasTextFocus(),
          anchor: model.getOffsetAt({
            lineNumber: selection.selectionStartLineNumber,
            column: selection.selectionStartColumn,
          }),
          head: model.getOffsetAt({
            lineNumber: selection.positionLineNumber,
            column: selection.positionColumn,
          }),
        };
      },
      restore: (snapshot) => {
        if (
          restoreEditorSnapshot(editorRef.current, monacoRef.current, snapshot)
        ) {
          pendingRestoreRef.current = undefined;
        } else {
          pendingRestoreRef.current = snapshot;
        }
      },
    }),
    []
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      const pendingRestore = pendingRestoreRef.current;
      if (pendingRestore) {
        restoreEditorSnapshot(editor, monaco, pendingRestore);
        pendingRestoreRef.current = undefined;
      }
      synchronizeAutoTypings();
      onReady?.();
    },
    [onReady, synchronizeAutoTypings]
  );

  if (!isReady) return fallback;

  return (
    <MonacoEditor
      height={height}
      language="typescript"
      path={modelPath}
      value={value}
      theme={isDarkMode ? 'vs-dark' : 'vs'}
      loading={fallback}
      options={{
        accessibilitySupport: 'auto',
        ariaLabel,
        automaticLayout: true,
        fontSize: 16,
        lineNumbers: 'off',
        minimap: { enabled: false },
        readOnly,
      }}
      onChange={(nextValue) => {
        if (nextValue !== undefined) onChange?.(nextValue);
      }}
      onMount={handleMount}
    />
  );
});

export const TypeScriptEditor: ForwardRefExoticComponent<
  TypeScriptEditorProps & RefAttributes<TypeScriptEditorHandle>
> = TypeScriptEditorComponent;
