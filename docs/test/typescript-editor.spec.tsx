import React, { createRef } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
  () => ({ __esModule: true, default: 'export const Module = {};' }),
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
  expect(mockAddExtraLib).toHaveBeenCalledTimes(5);
});
