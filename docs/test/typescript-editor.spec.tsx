import React, { createRef } from 'react';
import ts from 'typescript';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Editor } from '../src/components/editor';
import {
  TypeScriptEditor,
  type TypeScriptEditorHandle,
} from '../src/components/typescript-editor';

type MockPosition = Readonly<{ lineNumber: number; column: number }>;
type MockSelection = Readonly<{
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}>;

type MockEditorState = {
  anchor: number;
  head: number;
  textarea: HTMLTextAreaElement | null;
  value: string;
};

const mockAddExtraLib = jest.fn();
const mockSetCompilerOptions = jest.fn();
const mockSetDiagnosticsOptions = jest.fn();
const mockEditorStates: MockEditorState[] = [];
const mockAutoTypesDispose = jest.fn();
const mockAutoTypesCreate = jest.fn();
const mockCacheClear = jest.fn();
const mockLocalStorageCache = jest.fn().mockImplementation(() => ({
  clear: mockCacheClear,
}));

const mockOffsetAt = (value: string, position: MockPosition): number => {
  const lines = value.split('\n');
  return (
    lines
      .slice(0, position.lineNumber - 1)
      .reduce((offset, line) => offset + line.length + 1, 0) +
    position.column -
    1
  );
};

const mockPositionAt = (value: string, offset: number): MockPosition => {
  const before = value.slice(0, offset);
  const lines = before.split('\n');
  return {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
};

class MockMonacoSelection implements MockSelection {
  constructor(
    readonly selectionStartLineNumber: number,
    readonly selectionStartColumn: number,
    readonly positionLineNumber: number,
    readonly positionColumn: number
  ) {}
}

const mockMonaco = {
  Selection: MockMonacoSelection,
  languages: {
    typescript: {
      ModuleResolutionKind: { NodeJs: 2 },
      typescriptDefaults: {
        addExtraLib: mockAddExtraLib,
        getCompilerOptions: jest.fn(() => ({ target: 'ESNext' })),
        setCompilerOptions: mockSetCompilerOptions,
        setDiagnosticsOptions: mockSetDiagnosticsOptions,
      },
    },
  },
};

jest.mock('@monaco-editor/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  function MockMonacoEditor({
    language,
    loading,
    onChange,
    onMount,
    options,
    path,
    value,
  }: any) {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const stateRef = React.useRef<MockEditorState>({
      anchor: 0,
      head: 0,
      textarea: null,
      value,
    });

    stateRef.current.value = value;

    React.useEffect(() => {
      const state = stateRef.current;
      state.textarea = textareaRef.current;
      mockEditorStates.push(state);

      const model = {
        getValueLength: () => state.value.length,
        getOffsetAt: (position: MockPosition) =>
          mockOffsetAt(state.value, position),
        getPositionAt: (offset: number) => mockPositionAt(state.value, offset),
      };
      const editor = {
        focus: () => state.textarea?.focus(),
        getModel: () => model,
        getSelection: (): MockSelection => {
          const anchor = mockPositionAt(state.value, state.anchor);
          const head = mockPositionAt(state.value, state.head);
          return new MockMonacoSelection(
            anchor.lineNumber,
            anchor.column,
            head.lineNumber,
            head.column
          );
        },
        getValue: () => state.value,
        hasTextFocus: () =>
          globalThis.document.activeElement === state.textarea,
        setSelection: (selection: MockSelection) => {
          state.anchor = mockOffsetAt(state.value, {
            lineNumber: selection.selectionStartLineNumber,
            column: selection.selectionStartColumn,
          });
          state.head = mockOffsetAt(state.value, {
            lineNumber: selection.positionLineNumber,
            column: selection.positionColumn,
          });
          state.textarea?.setSelectionRange(
            Math.min(state.anchor, state.head),
            Math.max(state.anchor, state.head),
            state.anchor > state.head ? 'backward' : 'forward'
          );
        },
      };
      onMount(editor, mockMonaco);

      return () => {
        const index = mockEditorStates.indexOf(state);
        if (index >= 0) mockEditorStates.splice(index, 1);
      };
    }, [onMount]);

    if (!language) return loading;

    return (
      <textarea
        ref={textareaRef}
        aria-label={options.ariaLabel}
        data-language={language}
        data-model-path={path}
        value={value}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          stateRef.current.value = nextValue;
          onChange?.(nextValue);
        }}
      />
    );
  }

  return {
    __esModule: true,
    default: MockMonacoEditor,
    loader: { config: jest.fn() },
  };
});

jest.mock('monaco-editor-auto-typings/custom-editor', () => ({
  AutoTypings: {
    create: (...args: unknown[]) => mockAutoTypesCreate(...args),
  },
  LocalStorageCache: mockLocalStorageCache,
}));

jest.mock('monaco-editor/esm/vs/editor/editor.api', () => mockMonaco, {
  virtual: true,
});
jest.mock(
  'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution',
  () => ({}),
  { virtual: true }
);
jest.mock(
  'monaco-editor/esm/vs/language/typescript/monaco.contribution',
  () => ({}),
  { virtual: true }
);
jest.mock(
  'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution',
  () => ({}),
  { virtual: true }
);
jest.mock(
  'monaco-editor/esm/vs/editor/editor.worker?worker',
  () => ({ __esModule: true, default: class MockEditorWorker {} }),
  { virtual: true }
);
jest.mock(
  'monaco-editor/esm/vs/language/typescript/ts.worker?worker',
  () => ({ __esModule: true, default: class MockTypeScriptWorker {} }),
  { virtual: true }
);

jest.mock(
  '../../di/src/lib/hkt.ts?raw',
  () => ({ __esModule: true, default: 'export type HKT = unknown;' }),
  { virtual: true }
);
jest.mock(
  '../../di/src/index.ts?raw',
  () => ({
    __esModule: true,
    default:
      'export type DefaultModuleFactory = { readonly kind: "favy" };' +
      ' export declare const Module: DefaultModuleFactory;',
  }),
  { virtual: true }
);
jest.mock(
  '../../di/src/lib/makeModule.ts?raw',
  () => ({ __esModule: true, default: 'export const makeModule = {};' }),
  { virtual: true }
);
jest.mock(
  '../../di/src/lib/module.ts?raw',
  () => ({ __esModule: true, default: 'export const module = {};' }),
  { virtual: true }
);

const props = {
  value: 'const answer = 42',
  height: 108,
  modelPath: 'file:///docs/example.ts',
  ariaLabel: 'TypeScript example',
  fallback: <pre>fallback</pre>,
} as const;

const flushDynamicImports = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const editorTextarea = () =>
  screen.findByRole('textbox', { name: 'TypeScript example' });

const mockEditorSelection = () => {
  const state = mockEditorStates[mockEditorStates.length - 1];
  return { anchor: state.anchor, head: state.head };
};

const mockEditorHasFocus = () => {
  const state = mockEditorStates[mockEditorStates.length - 1];
  return document.activeElement === state.textarea;
};

const typeScriptServiceFor = (
  source: string
): { service: ts.LanguageService; filename: string } => {
  const filename = 'file:///playground/index.ts';
  const files = new Map<string, string>(
    mockAddExtraLib.mock.calls.map(([content, file]) => [file, content])
  );
  files.set(filename, source);
  files.set('file:///node_modules/zod/package.json', '{"types":"index.d.ts"}');
  files.set(
    'file:///node_modules/zod/index.d.ts',
    'export declare const z: { string(): { parse(input: unknown): string } };'
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
  };
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => '0',
    getScriptSnapshot: (file) => {
      const content = files.get(file) ?? ts.sys.readFile(file);
      return content === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => 'file:///',
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (file) => files.has(file) || ts.sys.fileExists(file),
    readFile: (file) => files.get(file) ?? ts.sys.readFile(file),
    readDirectory: ts.sys.readDirectory,
    directoryExists: (directory) =>
      [...files.keys()].some((file) => file.startsWith(`${directory}/`)) ||
      ts.sys.directoryExists(directory),
    getDirectories: ts.sys.getDirectories,
  };
  return { service: ts.createLanguageService(host), filename };
};

const renderTypingHarness = (
  versions: Readonly<Record<string, string>> = { zod: 'latest' }
) => {
  const ref = createRef<TypeScriptEditorHandle>();
  const onRun = jest.fn();

  function Harness(): JSX.Element {
    const [value, setValue] = React.useState<string>(props.value);
    return (
      <>
        <TypeScriptEditor
          {...props}
          ref={ref}
          value={value}
          onChange={setValue}
          typingVersions={versions}
        />
        <button type="button" onClick={() => onRun(ref.current?.readValue())}>
          Run
        </button>
      </>
    );
  }

  return { ...render(<Harness />), onRun, ref };
};

beforeEach(() => {
  mockAutoTypesDispose.mockReset();
  mockAutoTypesCreate.mockReset().mockResolvedValue({
    dispose: mockAutoTypesDispose,
  });
  mockCacheClear.mockReset();
  mockLocalStorageCache.mockClear();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

it('keeps the fallback until Monaco is ready', async () => {
  render(<TypeScriptEditor {...props} />);

  expect(screen.getByText('fallback')).toBeTruthy();
  await act(async () => flushDynamicImports());

  const textarea = await editorTextarea();
  expect(textarea.getAttribute('data-language')).toBe('typescript');
  expect(mockAutoTypesCreate).not.toHaveBeenCalled();
});

it('forwards controlled edits and restores focus and selection', async () => {
  const onChange = jest.fn();
  const ref = createRef<TypeScriptEditorHandle>();
  render(<TypeScriptEditor {...props} ref={ref} onChange={onChange} />);

  fireEvent.change(await editorTextarea(), {
    target: { value: 'const n = 1' },
  });
  expect(onChange).toHaveBeenLastCalledWith('const n = 1');
  expect(ref.current?.readValue()).toBe('const n = 1');

  ref.current?.restore({ hadFocus: true, anchor: 6, head: 7 });
  expect(mockEditorSelection()).toEqual({ anchor: 6, head: 7 });
  expect(mockEditorHasFocus()).toBe(true);
  expect(ref.current?.capture()).toEqual({
    hadFocus: true,
    anchor: 6,
    head: 7,
  });
});

it('queues the latest restore until mount and clamps its offsets', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  render(<TypeScriptEditor {...props} ref={ref} />);

  ref.current?.restore({ hadFocus: false, anchor: 1, head: 2 });
  ref.current?.restore({ hadFocus: true, anchor: 1_000, head: -10 });

  await editorTextarea();
  expect(mockEditorSelection()).toEqual({
    anchor: props.value.length,
    head: 0,
  });
  expect(mockEditorHasFocus()).toBe(true);
});

it('initializes automatic typings with one shared cache and disposes listeners', async () => {
  const zodVersions = { zod: 'latest' } as const;
  const lodashVersions = { lodash: 'latest' } as const;
  const result = render(
    <>
      <TypeScriptEditor {...props} typingVersions={zodVersions} />
      <TypeScriptEditor
        {...props}
        modelPath="file:///docs/second.ts"
        typingVersions={lodashVersions}
      />
    </>
  );

  await screen.findAllByRole('textbox', { name: 'TypeScript example' });
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(2));

  const firstOptions = mockAutoTypesCreate.mock.calls[0][1];
  const secondOptions = mockAutoTypesCreate.mock.calls[1][1];
  expect(firstOptions).toMatchObject({
    monaco: mockMonaco,
    versions: { zod: 'latest' },
    onlySpecifiedPackages: true,
    preloadPackages: true,
    shareCache: true,
    debounceDuration: 1_000,
    fileRootPath: 'file:///',
    dontAdaptEditorOptions: true,
    dontRefreshModelValueAfterResolvement: true,
    onError: expect.any(Function),
  });
  expect(firstOptions.versions).not.toBe(zodVersions);
  expect(secondOptions.versions).toEqual({ lodash: 'latest' });
  expect(firstOptions.sourceCache).toBe(secondOptions.sourceCache);
  expect(mockLocalStorageCache).toHaveBeenCalledTimes(1);

  result.unmount();
  expect(mockAutoTypesDispose).toHaveBeenCalledTimes(2);
  expect(mockCacheClear).not.toHaveBeenCalled();
});

it('keeps editing and Run enabled when automatic typing creation rejects', async () => {
  mockAutoTypesCreate.mockRejectedValueOnce(new Error('typing unavailable'));
  const { onRun } = renderTypingHarness();

  const textarea = await editorTextarea();
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(textarea, { target: { value: 'const edited = true' } });
  const runButton = screen.getByRole('button', { name: 'Run' });
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(runButton);

  expect(onRun).toHaveBeenCalledWith('const edited = true');
});

it('keeps editing and Run enabled after an automatic typing acquisition error', async () => {
  let reportAcquisitionError: ((error: string) => void) | undefined;
  mockAutoTypesCreate.mockImplementationOnce(
    async (
      _editor: unknown,
      options: { onError?: (error: string) => void }
    ) => {
      reportAcquisitionError = options.onError;
      return { dispose: mockAutoTypesDispose };
    }
  );
  const { onRun } = renderTypingHarness();

  const textarea = await editorTextarea();
  await waitFor(() => expect(reportAcquisitionError).toBeDefined());
  act(() => reportAcquisitionError?.('declaration request failed'));
  fireEvent.change(textarea, { target: { value: 'const edited = true' } });
  const runButton = screen.getByRole('button', { name: 'Run' });
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(runButton);

  expect(onRun).toHaveBeenCalledWith('const edited = true');
});

it('immediately disposes an automatic typings instance created after cleanup', async () => {
  let resolveCreate: ((instance: { dispose(): void }) => void) | undefined;
  mockAutoTypesCreate.mockImplementationOnce(
    () =>
      new Promise<{ dispose(): void }>((resolve) => {
        resolveCreate = resolve;
      })
  );
  const result = renderTypingHarness();

  await editorTextarea();
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1));
  result.unmount();
  await act(async () => {
    resolveCreate?.({ dispose: mockAutoTypesDispose });
    await Promise.resolve();
  });

  expect(mockAutoTypesDispose).toHaveBeenCalledTimes(1);
  expect(mockCacheClear).not.toHaveBeenCalled();
});

it('does not initialize automatic typings after cleanup during module loading', async () => {
  const result = renderTypingHarness();

  result.unmount();
  await act(async () => flushDynamicImports());

  expect(mockAutoTypesCreate).not.toHaveBeenCalled();
  expect(mockAutoTypesDispose).not.toHaveBeenCalled();
  expect(mockCacheClear).not.toHaveBeenCalled();
});

it('uses distinct model paths and registers local libraries once', async () => {
  render(
    <>
      <Editor code="const first = 1" />
      <Editor code="const second = 2" />
    </>
  );

  const textareas = await screen.findAllByRole('textbox', {
    name: 'TypeScript example',
  });
  const modelPaths = textareas.map((textarea) =>
    textarea.getAttribute('data-model-path')
  );

  expect(modelPaths).toHaveLength(2);
  expect(modelPaths[0]).not.toBe(modelPaths[1]);
  expect(modelPaths.every((path) => path?.startsWith('file:///docs/'))).toBe(
    true
  );
  expect(mockAddExtraLib).toHaveBeenCalledTimes(6);
  expect(mockSetCompilerOptions).toHaveBeenCalledWith({
    target: 'ESNext',
    strict: true,
    strictFunctionTypes: true,
    moduleResolution: 2,
    allowSyntheticDefaultImports: true,
    noEmit: true,
  });
  expect(mockAddExtraLib).toHaveBeenCalledWith(
    '{"types":"src/index.ts"}',
    'file:///node_modules/@favy/di/package.json'
  );
});

it('resolves local and acquired node_modules declarations with quick info', () => {
  const source = [
    "import { Module } from '@favy/di';",
    "import { z } from 'zod';",
    'const localModule = Module;',
    "const externalAnswer = z.string().parse('ok');",
  ].join('\n');
  const { filename, service } = typeScriptServiceFor(source);
  const localInfo = service.getQuickInfoAtPosition(
    filename,
    source.lastIndexOf('Module')
  );
  const externalInfo = service.getQuickInfoAtPosition(
    filename,
    source.lastIndexOf('externalAnswer')
  );

  expect(ts.displayPartsToString(localInfo?.displayParts)).toContain(
    'DefaultModuleFactory'
  );
  expect(ts.displayPartsToString(externalInfo?.displayParts)).toContain(
    'string'
  );
  expect(service.getSemanticDiagnostics(filename)).toEqual([]);
  expect(service.getCompilerOptionsDiagnostics()).toEqual([]);
});
