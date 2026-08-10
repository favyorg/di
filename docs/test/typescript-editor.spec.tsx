import React, { createRef } from 'react';
import ts from 'typescript';
import type { Monaco } from '@monaco-editor/react';
import type { SourceCache, SourceResolver } from 'monaco-editor-auto-typings';
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
import { favyDiSourceFiles } from '../src/components/playground/favy-di-sources';

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

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}>;

type MockCreatedModel = Readonly<{
  dispose: jest.Mock<void, []>;
  getValue(): string;
}>;

type GenerationOptions = Readonly<{
  monaco: Monaco;
  sourceCache: SourceCache;
  sourceResolver: SourceResolver;
}>;

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const mockAddExtraLib = jest.fn();
const mockSetCompilerOptions = jest.fn();
const mockSetDiagnosticsOptions = jest.fn();
const mockEditorStates: MockEditorState[] = [];
let mockAfterSetSelection: (() => void) | undefined;
const mockAutoTypesDispose = jest.fn();
const mockAutoTypesCreate = jest.fn();
const mockCacheClear = jest.fn();
const mockCacheGetFile = jest.fn();
const mockCacheStoreFile = jest.fn();
const mockLocalStorageCache = jest.fn().mockImplementation(() => ({
  clear: mockCacheClear,
  getFile: mockCacheGetFile,
  storeFile: mockCacheStoreFile,
}));
const mockMonacoModels = new Map<unknown, MockCreatedModel>();
const mockMonacoCreateModel = jest.fn(
  (content: string, _language: string, uri: unknown): MockCreatedModel => {
    const model: MockCreatedModel = {
      dispose: jest.fn(() => {
        mockMonacoModels.delete(uri);
      }),
      getValue: () => content,
    };
    mockMonacoModels.set(uri, model);
    return model;
  }
);
const mockMonacoGetModel = jest.fn(
  (uri: unknown) => mockMonacoModels.get(uri) ?? null
);

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
  editor: {
    createModel: mockMonacoCreateModel,
    getModel: mockMonacoGetModel,
  },
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
        getDomNode: () => state.textarea,
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
          mockAfterSetSelection?.();
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

const editorTextarea = async (): Promise<HTMLTextAreaElement> => {
  const element = await screen.findByRole('textbox', {
    name: 'TypeScript example',
  });
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error('Missing mocked TypeScript editor textarea.');
  }
  return element;
};

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

const originalFetch = globalThis.fetch;

const arrangePendingGeneration = (label: string) => {
  const pendingFetch = deferred<Response>();
  const pendingCacheRead = deferred<string | undefined>();
  const pendingModelWrite = deferred<void>();
  const fetchSource = jest.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) => pendingFetch.promise
  ) as unknown as typeof globalThis.fetch;
  globalThis.fetch = fetchSource;
  mockCacheGetFile.mockImplementationOnce(() => pendingCacheRead.promise);

  const unownedUri = { path: `/unowned-${label}.d.ts` } as never;
  const ownedUri = { path: `/owned-${label}.d.ts` } as never;
  const lateUri = { path: `/late-${label}.d.ts` } as never;
  const unownedModel = mockMonaco.editor.createModel(
    'export type Unowned = true',
    'typescript',
    unownedUri
  );
  let ownedModel: MockCreatedModel | undefined;
  let resolverResult: Promise<string | undefined> | undefined;
  let cacheResult: Promise<string | undefined> | undefined;
  let lateModelResult: Promise<unknown> | undefined;
  let lateStoreResult: Promise<void> | undefined;

  mockAutoTypesCreate.mockImplementationOnce(
    async (_editor: unknown, options: GenerationOptions) => {
      ownedModel = options.monaco.editor.createModel(
        'export type Owned = true',
        'typescript',
        ownedUri
      ) as unknown as MockCreatedModel;
      resolverResult = options.sourceResolver.resolveSourceFile(
        'pkg',
        '1',
        'index.d.ts'
      );
      cacheResult = options.sourceCache.getFile('pkg@1/index.d.ts');
      lateModelResult = pendingModelWrite.promise.then(() =>
        options.monaco.editor.createModel(
          'export type Late = true',
          'typescript',
          lateUri
        )
      );
      lateStoreResult = resolverResult.then(async (source) => {
        if (source) {
          await options.sourceCache.storeFile('pkg@1/index.d.ts', source);
        }
      });
      return { dispose: mockAutoTypesDispose };
    }
  );

  return {
    fetchSource,
    pendingCacheRead,
    pendingFetch,
    pendingModelWrite,
    unownedModel,
    get ownedModel() {
      return ownedModel;
    },
    async finishLateWork() {
      const fetchedResponse = {
        ok: true,
        status: 200,
        text: jest.fn(async () => 'export type Old = true'),
      } as unknown as Response;
      pendingFetch.resolve(fetchedResponse);
      pendingCacheRead.resolve('export type CachedOld = true');
      pendingModelWrite.resolve(undefined);
      return {
        cache: await cacheResult,
        model: await lateModelResult,
        resolver: await resolverResult,
        store: await lateStoreResult,
        text: fetchedResponse.text,
      };
    },
  };
};

beforeEach(() => {
  mockAfterSetSelection = undefined;
  mockAutoTypesDispose.mockReset();
  mockAutoTypesCreate.mockReset().mockResolvedValue({
    dispose: mockAutoTypesDispose,
  });
  mockCacheClear.mockReset();
  mockCacheGetFile.mockReset().mockResolvedValue(undefined);
  mockCacheStoreFile.mockReset().mockResolvedValue(undefined);
  mockLocalStorageCache.mockClear();
  mockMonacoCreateModel.mockClear();
  mockMonacoGetModel.mockClear();
  mockMonacoModels.clear();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('maps the checked-out package sources to Monaco and Sandpack paths', () => {
  expect(
    favyDiSourceFiles.map(({ packagePath, sandboxPath }) => [
      packagePath,
      sandboxPath,
    ])
  ).toEqual([
    ['src/index.ts', '/favy-di/index.ts'],
    ['src/lib/hkt.ts', '/favy-di/lib/hkt.ts'],
    ['src/lib/makeModule.ts', '/favy-di/lib/makeModule.ts'],
    ['src/lib/module.ts', '/favy-di/lib/module.ts'],
  ]);
});

it('keeps the fallback until Monaco is ready', async () => {
  render(<TypeScriptEditor {...props} />);

  expect(screen.getByText('fallback')).toBeTruthy();
  await act(async () => flushDynamicImports());

  const textarea = await editorTextarea();
  expect(textarea.getAttribute('data-language')).toBe('typescript');
  expect(mockAutoTypesCreate).not.toHaveBeenCalled();
});

it('installs one focus-generation tracker per editor document', async () => {
  const firstRef = createRef<TypeScriptEditorHandle>();
  const secondRef = createRef<TypeScriptEditorHandle>();
  const listenerSpy = jest.spyOn(document, 'addEventListener');
  render(
    <>
      <TypeScriptEditor {...props} ref={firstRef} />
      <TypeScriptEditor
        {...props}
        ref={secondRef}
        ariaLabel="Second TypeScript example"
        modelPath="file:///docs/second.ts"
      />
    </>
  );
  const textareas = await screen.findAllByRole('textbox');
  const registrationsBeforeCapture = listenerSpy.mock.calls.filter(
    ([type]) => type === 'focusin'
  ).length;

  textareas[0].focus();
  firstRef.current?.capture();
  textareas[1].focus();
  secondRef.current?.capture();

  expect(
    listenerSpy.mock.calls.filter(([type]) => type === 'focusin').length -
      registrationsBeforeCapture
  ).toBe(1);
  listenerSpy.mockRestore();
});

it('forwards controlled edits and restores selection without inferred focus', async () => {
  const onChange = jest.fn();
  const ref = createRef<TypeScriptEditorHandle>();
  render(<TypeScriptEditor {...props} ref={ref} onChange={onChange} />);

  fireEvent.change(await editorTextarea(), {
    target: { value: 'const n = 1' },
  });
  expect(onChange).toHaveBeenLastCalledWith('const n = 1');
  expect(ref.current?.readValue()).toBe('const n = 1');

  ref.current?.restore({ hadFocus: false, anchor: 6, head: 7 });
  expect(mockEditorSelection()).toEqual({ anchor: 6, head: 7 });
  expect(mockEditorHasFocus()).toBe(false);
  expect(ref.current?.capture()).toEqual({
    hadFocus: false,
    anchor: 6,
    head: 7,
  });
});

it('does not steal focus moved outside before editor replacement', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor {...props} ref={ref} />
    </>
  );
  const outgoing = await editorTextarea();
  outgoing.focus();
  ref.current?.restore({ hadFocus: false, anchor: 6, head: 11 });
  const snapshot = ref.current?.capture();
  if (!snapshot) throw new Error('Expected an editor snapshot.');
  const outside = screen.getByRole('button', { name: 'Outside' });
  outside.focus();

  result.rerender(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor key="replacement" {...props} ref={ref} />
    </>
  );
  ref.current?.restore(snapshot);
  const replacement = await editorTextarea();

  expect(replacement).not.toBe(outgoing);
  expect(replacement.selectionStart).toBe(6);
  expect(replacement.selectionEnd).toBe(11);
  expect(document.activeElement).toBe(outside);
});

it('captures a focus guard only while Monaco reports text focus', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  render(<TypeScriptEditor {...props} ref={ref} />);
  const input = await editorTextarea();
  type GuardedSnapshot = Readonly<{
    focusGuard?: Readonly<{
      document: Document;
      focusedElement: Element;
      generation: number;
    }>;
  }>;

  const unfocused = ref.current?.capture() as GuardedSnapshot | undefined;
  expect(unfocused?.focusGuard).toBeUndefined();

  input.focus();
  const focused = ref.current?.capture() as GuardedSnapshot | undefined;
  expect(focused?.focusGuard).toEqual({
    document,
    focusedElement: input,
    generation: expect.any(Number),
  });
});

it('restores focus and selection when focused editor replacement is uninterrupted', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(<TypeScriptEditor {...props} ref={ref} />);
  const outgoing = await editorTextarea();
  outgoing.focus();
  ref.current?.restore({ hadFocus: false, anchor: 4, head: 12 });
  const snapshot = ref.current?.capture();
  if (!snapshot) throw new Error('Expected an editor snapshot.');

  result.rerender(<TypeScriptEditor key="replacement" {...props} ref={ref} />);
  expect(outgoing.isConnected).toBe(false);
  expect(document.activeElement).toBe(document.body);
  ref.current?.restore(snapshot);
  const replacement = await editorTextarea();

  expect(replacement).not.toBe(outgoing);
  expect(replacement.selectionStart).toBe(4);
  expect(replacement.selectionEnd).toBe(12);
  expect(document.activeElement).toBe(replacement);
});

it('restores selection without focusing when the outgoing editor was unfocused', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor {...props} ref={ref} />
    </>
  );
  const outgoing = await editorTextarea();
  const outside = screen.getByRole('button', { name: 'Outside' });
  outside.focus();
  ref.current?.restore({ hadFocus: false, anchor: 5, head: 9 });
  const snapshot = ref.current?.capture();
  if (!snapshot) throw new Error('Expected an editor snapshot.');

  result.rerender(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor key="replacement" {...props} ref={ref} />
    </>
  );
  ref.current?.restore(snapshot);
  const replacement = await editorTextarea();

  expect(replacement).not.toBe(outgoing);
  expect(replacement.selectionStart).toBe(5);
  expect(replacement.selectionEnd).toBe(9);
  expect(document.activeElement).toBe(outside);
});

it('requires captured focus intent even when every focus guard still matches', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(<TypeScriptEditor {...props} ref={ref} />);
  const outgoing = await editorTextarea();
  outgoing.focus();
  ref.current?.restore({ hadFocus: false, anchor: 5, head: 13 });
  const snapshot = ref.current?.capture();
  if (!snapshot?.focusGuard) throw new Error('Expected a guarded snapshot.');

  result.rerender(<TypeScriptEditor key="replacement" {...props} ref={ref} />);
  expect(outgoing.isConnected).toBe(false);
  expect(document.activeElement).toBe(document.body);
  ref.current?.restore({ ...snapshot, hadFocus: false });
  const replacement = await editorTextarea();

  expect(replacement.selectionStart).toBe(5);
  expect(replacement.selectionEnd).toBe(13);
  expect(document.activeElement).toBe(document.body);
});

it('does not restore focus over an active external element with a matching generation', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor {...props} ref={ref} />
    </>
  );
  const outgoing = await editorTextarea();
  outgoing.focus();
  ref.current?.restore({ hadFocus: false, anchor: 3, head: 9 });
  const snapshot = ref.current?.capture();
  if (!snapshot?.focusGuard) throw new Error('Expected a guarded snapshot.');
  const outside = screen.getByRole('button', { name: 'Outside' });
  outside.focus();
  const currentGenerationSnapshot = {
    ...snapshot,
    focusGuard: {
      ...snapshot.focusGuard,
      generation: snapshot.focusGuard.generation + 1,
    },
  };

  result.rerender(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor key="replacement" {...props} ref={ref} />
    </>
  );
  ref.current?.restore(currentGenerationSnapshot);
  const replacement = await editorTextarea();

  expect(outgoing.isConnected).toBe(false);
  expect(replacement.selectionStart).toBe(3);
  expect(replacement.selectionEnd).toBe(9);
  expect(document.activeElement).toBe(outside);
});

it('does not restore focus while the captured focused element is still connected', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  render(<TypeScriptEditor {...props} ref={ref} />);
  const input = await editorTextarea();
  input.focus();
  ref.current?.restore({ hadFocus: false, anchor: 3, head: 10 });
  const snapshot = ref.current?.capture();
  if (!snapshot) throw new Error('Expected an editor snapshot.');
  input.blur();

  ref.current?.restore(snapshot);

  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(10);
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(document.body);
});

it('does not restore focus after an intervening focus target is removed', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(<TypeScriptEditor {...props} ref={ref} />);
  const outgoing = await editorTextarea();
  outgoing.focus();
  ref.current?.restore({ hadFocus: false, anchor: 2, head: 8 });
  const snapshot = ref.current?.capture();
  if (!snapshot) throw new Error('Expected an editor snapshot.');
  const intervening = document.createElement('button');
  document.body.append(intervening);
  intervening.focus();
  intervening.remove();

  result.rerender(<TypeScriptEditor key="replacement" {...props} ref={ref} />);
  ref.current?.restore(snapshot);
  const replacement = await editorTextarea();

  expect(outgoing.isConnected).toBe(false);
  expect(replacement.selectionStart).toBe(2);
  expect(replacement.selectionEnd).toBe(8);
  expect(document.activeElement).toBe(document.body);
});

it('checks focus intent immediately after restoring selection', async () => {
  const ref = createRef<TypeScriptEditorHandle>();
  const result = render(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor {...props} ref={ref} />
    </>
  );
  const outgoing = await editorTextarea();
  outgoing.focus();
  ref.current?.restore({ hadFocus: false, anchor: 1, head: 7 });
  const snapshot = ref.current?.capture();
  if (!snapshot) throw new Error('Expected an editor snapshot.');

  result.rerender(
    <>
      <button type="button">Outside</button>
      <TypeScriptEditor key="replacement" {...props} ref={ref} />
    </>
  );
  const outside = screen.getByRole('button', { name: 'Outside' });
  mockAfterSetSelection = () => outside.focus();
  ref.current?.restore(snapshot);
  const replacement = await editorTextarea();

  expect(replacement.selectionStart).toBe(1);
  expect(replacement.selectionEnd).toBe(7);
  expect(document.activeElement).toBe(outside);
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
  expect(mockEditorHasFocus()).toBe(false);
});

it('initializes guarded automatic typings with one shared backing cache', async () => {
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
    versions: { zod: 'latest' },
    onlySpecifiedPackages: true,
    preloadPackages: true,
    shareCache: false,
    debounceDuration: 0,
    fileRootPath: 'file:///',
    dontAdaptEditorOptions: true,
    dontRefreshModelValueAfterResolvement: true,
    onError: expect.any(Function),
  });
  expect(firstOptions.versions).not.toBe(zodVersions);
  expect(secondOptions.versions).toEqual({ lodash: 'latest' });
  expect(firstOptions.monaco).not.toBe(mockMonaco);
  expect(firstOptions.monaco.editor).not.toBe(mockMonaco.editor);
  expect(firstOptions.monaco.languages).toBe(mockMonaco.languages);
  expect(firstOptions.sourceCache).not.toBe(secondOptions.sourceCache);
  expect(firstOptions.sourceResolver).toBeDefined();
  expect(secondOptions.sourceResolver).toBeDefined();
  expect(mockLocalStorageCache).toHaveBeenCalledTimes(1);
  await firstOptions.sourceCache.storeFile('first', 'first content');
  await secondOptions.sourceCache.storeFile('second', 'second content');
  expect(mockCacheStoreFile).toHaveBeenNthCalledWith(
    1,
    'first',
    'first content'
  );
  expect(mockCacheStoreFile).toHaveBeenNthCalledWith(
    2,
    'second',
    'second content'
  );
  await waitFor(() => expect(mockAutoTypesDispose).toHaveBeenCalledTimes(2));

  result.unmount();
  expect(mockAutoTypesDispose).toHaveBeenCalledTimes(2);
  expect(mockCacheClear).not.toHaveBeenCalled();
});

it('reacquires only for a distinct sorted typing-version signature', async () => {
  const result = render(
    <TypeScriptEditor
      {...props}
      typingVersions={{ zod: '3.0.0', lodash: '4.0.0' }}
    />
  );

  await editorTextarea();
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1));
  result.rerender(
    <TypeScriptEditor
      {...props}
      value="const edited = true"
      typingVersions={{ lodash: '4.0.0', zod: '3.0.0' }}
    />
  );
  await act(async () => flushDynamicImports());

  expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1);

  result.rerender(
    <TypeScriptEditor
      {...props}
      value="const edited again = true"
      typingVersions={{ zod: '3.1.0', lodash: '4.0.0' }}
    />
  );
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(2));
  expect(mockAutoTypesCreate.mock.calls[1][1].versions).toEqual({
    lodash: '4.0.0',
    zod: '3.1.0',
  });

  result.rerender(
    <TypeScriptEditor
      {...props}
      value="const finalEdit = true"
      typingVersions={{ lodash: '4.0.0', zod: '3.1.0' }}
    />
  );
  await act(async () => flushDynamicImports());
  expect(mockAutoTypesCreate).toHaveBeenCalledTimes(2);
});

it('invalidates acquisition when typing versions become unavailable', async () => {
  const result = render(
    <TypeScriptEditor {...props} typingVersions={{ zod: '3.0.0' }} />
  );

  await editorTextarea();
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1));
  const firstOptions = mockAutoTypesCreate.mock
    .calls[0][1] as GenerationOptions;
  const ownedModel = firstOptions.monaco.editor.createModel(
    'export type Version = "old"',
    'typescript',
    { path: '/node_modules/zod/index.d.ts' } as never
  ) as unknown as MockCreatedModel;

  result.rerender(<TypeScriptEditor {...props} typingVersions={undefined} />);
  await act(async () => flushDynamicImports());

  expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1);
  expect(ownedModel.dispose).toHaveBeenCalledTimes(1);

  result.rerender(
    <TypeScriptEditor {...props} typingVersions={{ zod: '3.0.0' }} />
  );
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(2));
});

it('invalidates pending resolver, cache, and model work on version change', async () => {
  const race = arrangePendingGeneration('version-change');
  const result = render(
    <TypeScriptEditor {...props} typingVersions={{ pkg: '1' }} />
  );

  await editorTextarea();
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockAutoTypesDispose).toHaveBeenCalledTimes(1));
  const fetchSignal = (race.fetchSource as unknown as jest.Mock).mock
    .calls[0][1].signal as AbortSignal;

  result.rerender(
    <TypeScriptEditor {...props} typingVersions={{ pkg: '2' }} />
  );
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(2));

  expect(fetchSignal.aborted).toBe(true);
  const late = await race.finishLateWork();
  expect(late.resolver).toBeUndefined();
  expect(late.cache).toBeUndefined();
  expect(late.model).toBeUndefined();
  expect(late.text).not.toHaveBeenCalled();
  expect(mockCacheStoreFile).not.toHaveBeenCalled();
  expect(mockMonacoCreateModel).toHaveBeenCalledTimes(2);
  expect(race.ownedModel?.dispose).toHaveBeenCalledTimes(1);
  expect(race.unownedModel.dispose).not.toHaveBeenCalled();
});

it('invalidates pending resolver, cache, and model work on unmount', async () => {
  const race = arrangePendingGeneration('unmount');
  const result = render(
    <TypeScriptEditor {...props} typingVersions={{ pkg: '1' }} />
  );

  await editorTextarea();
  await waitFor(() => expect(mockAutoTypesCreate).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockAutoTypesDispose).toHaveBeenCalledTimes(1));
  const fetchSignal = (race.fetchSource as unknown as jest.Mock).mock
    .calls[0][1].signal as AbortSignal;

  result.unmount();

  expect(fetchSignal.aborted).toBe(true);
  const late = await race.finishLateWork();
  expect(late.resolver).toBeUndefined();
  expect(late.cache).toBeUndefined();
  expect(late.model).toBeUndefined();
  expect(late.text).not.toHaveBeenCalled();
  expect(mockCacheStoreFile).not.toHaveBeenCalled();
  expect(mockMonacoCreateModel).toHaveBeenCalledTimes(2);
  expect(race.ownedModel?.dispose).toHaveBeenCalledTimes(1);
  expect(race.unownedModel.dispose).not.toHaveBeenCalled();
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
