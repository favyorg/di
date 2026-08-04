import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { Playground } from '../src/components/playground/playground';
import { playgroundExampleById } from '../src/components/playground/playground-examples';

type MockSandpackMessage =
  | { type: 'done'; compilatonError: boolean }
  | { type: 'action'; action: 'show-error' };

type MockSandpackContext = {
  code: string;
  setCode(code: string): void;
  runSandpack: jest.Mock<Promise<void>, []>;
  listen(listener: (message: MockSandpackMessage) => void): () => void;
};

let mockEvents: string[] = [];
let mockMountedProviders = 0;
let mockMaximumMountedProviders = 0;
let mockConsoleMountCounter = 0;
let mockRunMode: 'auto-done' | 'hold' | 'reject' = 'auto-done';
let mockEmitMessage: ((message: MockSandpackMessage) => void) | undefined;
let mockChangeHookIdentities: (() => void) | undefined;
let mockActiveListenerCount = 0;

jest.mock('@codesandbox/sandpack-react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const SandpackContext = React.createContext<any>(null);

  const useMockSandpack = () => {
    const context = React.useContext(SandpackContext);
    if (!context) throw new Error('Missing mocked SandpackProvider');
    return context;
  };

  const signatureFor = (dependencies: Record<string, string>): string =>
    Object.entries(dependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => `${name}@${version}`)
      .join('|');

  const SandpackProvider = ({ children, customSetup, files }: any) => {
    const signature = signatureFor(customSetup.dependencies);
    const [code, setCode] = React.useState(files['/index.ts']);
    const [hookIdentity, setHookIdentity] = React.useState(0);
    const listeners = React.useRef(new Set<(mockMessage: any) => void>());
    const runSandpack = React.useMemo(
      () =>
        jest.fn(async () => {
          mockEvents.push(`run:${signature}`);
          if (mockRunMode === 'reject') {
            throw new Error('Mock Sandpack launch failed');
          }
          if (mockRunMode === 'auto-done') {
            setTimeout(() => {
              listeners.current.forEach((listener) =>
                listener({ type: 'done', compilatonError: false })
              );
            }, 0);
          }
        }),
      [hookIdentity, signature]
    );
    const listen = React.useCallback(
      (mockListener: (mockMessage: any) => void) => {
        if (!listeners.current.has(mockListener)) {
          mockActiveListenerCount += 1;
        }
        listeners.current.add(mockListener);
        return () => {
          if (!listeners.current.delete(mockListener)) return;
          mockActiveListenerCount -= 1;
        };
      },
      [hookIdentity]
    );
    const changeHookIdentities = React.useCallback(
      () => setHookIdentity((current: number) => current + 1),
      []
    );

    React.useEffect(() => {
      const emitMessage = (mockMessage: any): void => {
        listeners.current.forEach((listener) => listener(mockMessage));
      };
      mockMountedProviders += 1;
      mockMaximumMountedProviders = Math.max(
        mockMaximumMountedProviders,
        mockMountedProviders
      );
      mockEvents.push(`mount:${signature}`);
      mockEmitMessage = emitMessage;
      mockChangeHookIdentities = changeHookIdentities;
      return () => {
        if (mockEmitMessage === emitMessage) mockEmitMessage = undefined;
        if (mockChangeHookIdentities === changeHookIdentities) {
          mockChangeHookIdentities = undefined;
        }
        mockActiveListenerCount -= listeners.current.size;
        listeners.current.clear();
        mockEvents.push(`unmount:${signature}`);
        mockMountedProviders -= 1;
      };
    }, [changeHookIdentities, signature]);

    const value = React.useMemo(
      () => ({ code, setCode, runSandpack, listen }),
      [code, listen, runSandpack]
    );
    return (
      <SandpackContext.Provider value={value}>
        {children}
      </SandpackContext.Provider>
    );
  };

  const SandpackCodeEditor = React.forwardRef<any, any>(
    function MockSandpackCodeEditor(_props, ref) {
      const { code, setCode } = useMockSandpack();
      const editorDomRef = React.useRef<any>(null);
      const textareaRef = React.useRef<any>(null);

      React.useImperativeHandle(ref, () => ({
        getCodemirror: () => {
          const editorDom = editorDomRef.current;
          const textarea = textareaRef.current;
          if (!editorDom || !textarea) return undefined;
          return {
            contentDOM: textarea,
            dom: editorDom,
            get hasFocus() {
              return globalThis.document.activeElement === textarea;
            },
            state: {
              selection: {
                main: {
                  anchor: textarea.selectionStart,
                  head: textarea.selectionEnd,
                },
              },
            },
            dispatch: (mockTransaction: any) =>
              textarea.setSelectionRange(
                mockTransaction.selection.anchor,
                mockTransaction.selection.head
              ),
            focus: () => textarea.focus(),
          };
        },
      }));

      return (
        <div aria-label="Code Editor for index.ts" role="textbox" tabIndex={0}>
          <div ref={editorDomRef}>
            <textarea
              ref={textareaRef}
              aria-label="Code Editor for index.ts"
              tabIndex={-1}
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          </div>
        </div>
      );
    }
  );

  const SandpackConsole = () => {
    const [mountId] = React.useState(() => ++mockConsoleMountCounter);
    return (
      <div aria-label="Console output" data-mount-id={mountId.toString()} />
    );
  };

  return {
    SandpackCodeEditor,
    SandpackConsole,
    SandpackProvider,
    useActiveCode: () => {
      const context = useMockSandpack();
      return {
        code: context.code,
        readOnly: false,
        updateCode: context.setCode,
      };
    },
    useSandpack: () => {
      const context = useMockSandpack();
      return {
        sandpack: { runSandpack: context.runSandpack },
        listen: context.listen,
      };
    },
  };
});

const editor = (): HTMLTextAreaElement => {
  const textarea = screen
    .getAllByRole('textbox')
    .find(
      (element): element is HTMLTextAreaElement =>
        element instanceof HTMLTextAreaElement
    );
  if (!textarea) throw new Error('Missing mocked CodeMirror content editor');
  return textarea;
};

const consoleMountId = (): string | null =>
  screen.getByLabelText('Console output').getAttribute('data-mount-id');

const mountEvents = (): string[] =>
  mockEvents.filter((event) => event.startsWith('mount:'));

const runEvents = (): string[] =>
  mockEvents.filter((event) => event.startsWith('run:'));

const emitSandpackMessage = (message: MockSandpackMessage): void => {
  act(() => {
    if (!mockEmitMessage) throw new Error('No mounted Sandpack provider');
    mockEmitMessage(message);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockEvents = [];
  mockMountedProviders = 0;
  mockMaximumMountedProviders = 0;
  mockConsoleMountCounter = 0;
  mockRunMode = 'auto-done';
  mockEmitMessage = undefined;
  mockChangeHookIdentities = undefined;
  mockActiveListenerCount = 0;
  document.documentElement.dataset.theme = 'light';
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  delete document.documentElement.dataset.theme;
});

it('exposes the playground controls and regions with accessible semantics', () => {
  render(<Playground />);

  expect(
    screen.getByRole('navigation', { name: 'Playground examples' })
  ).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Example' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset example' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Run code' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Ready');
  expect(
    screen.getByRole('region', { name: 'TypeScript playground' })
  ).toBeTruthy();
  const navigation = screen.getByRole('navigation', {
    name: 'Playground examples',
  });
  expect(within(navigation).getAllByRole('button')).toHaveLength(6);
  const selectedExample = within(navigation).getByRole('button', {
    name: 'Basic module',
    pressed: true,
  });
  expect(selectedExample.textContent).toContain(
    'Create and call one named module.'
  );
  const toolbar = screen.getByRole('toolbar', {
    name: 'Playground controls',
  });
  const toolbarButtons = within(toolbar).getAllByRole('button');
  expect(
    toolbarButtons.map((button) => button.getAttribute('aria-label'))
  ).toEqual(['Reset example', 'Run code']);
  expect(within(toolbar).getByText('Ctrl/⌘ + Enter')).toBeTruthy();
  expect(toolbar.getAttribute('aria-busy')).toBe('false');
  expect(screen.getByRole('region', { name: 'Code' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Console' })).toBeTruthy();
});

it('marks the controls busy while a run is active', () => {
  mockRunMode = 'hold';
  render(<Playground />);

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));

  expect(
    screen
      .getByRole('toolbar', { name: 'Playground controls' })
      .getAttribute('aria-busy')
  ).toBe('true');
});

it('gives both CodeMirror textboxes a stable accessible name', () => {
  render(<Playground />);

  expect(
    screen.queryByRole('textbox', { name: 'Code Editor for index.ts' })
  ).toBeNull();
  expect(
    screen.getAllByRole('textbox', { name: 'TypeScript playground editor' })
  ).toHaveLength(2);
});

it('stays ready through StrictMode effect replay', () => {
  render(
    <React.StrictMode>
      <Playground />
    </React.StrictMode>
  );

  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
});

it('mounts one provider, restores drafts, and resets only the active example', () => {
  render(<Playground />);
  const basicSource = playgroundExampleById.basic.source;
  const compositionSource = playgroundExampleById.composition.source;
  const basicDraft = `${basicSource}\n// Basic draft`;
  const compositionDraft = `${compositionSource}\n// Composition draft`;
  const initialConsole = consoleMountId();

  fireEvent.change(editor(), { target: { value: basicDraft } });
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionSource);
  expect(consoleMountId()).not.toBe(initialConsole);

  fireEvent.change(editor(), { target: { value: compositionDraft } });
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));
  expect(editor().value).toBe(basicDraft);
  const consoleBeforeReset = consoleMountId();

  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  expect(editor().value).toBe(basicSource);
  expect(consoleMountId()).not.toBe(consoleBeforeReset);

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionDraft);
  expect(mockMountedProviders).toBe(1);
  expect(mockMaximumMountedProviders).toBe(1);
  expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([]);
});

it('waits 1000 ms before remounting for a valid new import', () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });

  act(() => jest.advanceTimersByTime(999));
  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);

  act(() => jest.advanceTimersByTime(1));
  expect(mountEvents()).toEqual([
    'mount:@favy/di@3.0.0',
    'mount:@favy/di@3.0.0|lodash@latest',
  ]);
  expect(mockMaximumMountedProviders).toBe(1);
});

it('keeps the last valid dependency generation for an incomplete import', () => {
  render(<Playground />);
  const initialConsole = consoleMountId();

  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport value from '`,
    },
  });
  act(() => jest.advanceTimersByTime(1000));

  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(consoleMountId()).toBe(initialConsole);
  expect(mockMountedProviders).toBe(1);
});

it('does not run when the immediate import scan is incomplete', async () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport value from '`,
    },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  await act(async () => jest.runAllTimersAsync());

  expect(runEvents()).toEqual([]);
  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(screen.getByRole('status').textContent).toBe('Checking imports');
});

it('keeps Run busy after show-error and an edit until that run settles', () => {
  mockRunMode = 'hold';
  render(<Playground />);
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  act(() => jest.advanceTimersByTime(0));
  expect(runEvents()).toEqual(['run:@favy/di@3.0.0']);
  expect((runButton as HTMLButtonElement).disabled).toBe(true);

  emitSandpackMessage({ type: 'action', action: 'show-error' });
  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect((runButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(editor(), {
    target: { value: `${playgroundExampleById.basic.source}\n// Edited` },
  });
  fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
  act(() => jest.advanceTimersByTime(0));
  expect(screen.getByRole('status').textContent).toBe('Checking imports');
  expect((runButton as HTMLButtonElement).disabled).toBe(true);
  expect(runEvents()).toEqual(['run:@favy/di@3.0.0']);

  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('status').textContent).toBe('Checking imports');

  act(() => jest.advanceTimersByTime(1_000));
  expect(screen.getByRole('status').textContent).toBe('Ready');
});

it('defers a matured dependency remount until the active run settles', () => {
  mockRunMode = 'hold';
  render(<Playground />);

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  act(() => jest.advanceTimersByTime(0));
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  act(() => jest.advanceTimersByTime(1_000));

  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(runEvents()).toEqual(['run:@favy/di@3.0.0']);
  expect(screen.getByRole('status').textContent).toBe('Checking imports');

  emitSandpackMessage({ type: 'done', compilatonError: false });

  expect(mountEvents()).toEqual([
    'mount:@favy/di@3.0.0',
    'mount:@favy/di@3.0.0|lodash@latest',
  ]);
  expect(runEvents()).toEqual(['run:@favy/di@3.0.0']);
  expect(mockMaximumMountedProviders).toBe(1);
});

it('keeps the active listener when useSandpack callback identities change', () => {
  mockRunMode = 'hold';
  render(<Playground />);
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  act(() => jest.advanceTimersByTime(0));
  expect(mockActiveListenerCount).toBe(1);

  act(() => {
    if (!mockChangeHookIdentities) {
      throw new Error('No mounted Sandpack provider');
    }
    mockChangeHookIdentities();
  });

  expect(mockActiveListenerCount).toBe(1);
  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(mockActiveListenerCount).toBe(0);
});

it('settles a compilation failure and disposes its listener', () => {
  mockRunMode = 'hold';
  render(<Playground />);
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  act(() => jest.advanceTimersByTime(0));
  expect(mockActiveListenerCount).toBe(1);

  emitSandpackMessage({ type: 'done', compilatonError: true });

  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(mockActiveListenerCount).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([
  { outcome: 'launch rejection', mode: 'reject' as const, elapsed: 0 },
  { outcome: '30-second timeout', mode: 'hold' as const, elapsed: 30_000 },
])(
  'settles a $outcome and disposes its listener',
  async ({ mode, elapsed }) => {
    mockRunMode = mode;
    render(<Playground />);
    const runButton = screen.getByRole('button', { name: 'Run code' });

    fireEvent.click(runButton);
    await act(async () => jest.advanceTimersByTimeAsync(elapsed));

    expect(runEvents()).toEqual(['run:@favy/di@3.0.0']);
    expect(screen.getByRole('status').textContent).toBe('Failed');
    expect((runButton as HTMLButtonElement).disabled).toBe(false);
    expect(mockActiveListenerCount).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  }
);

it.each(['switch', 'reset'] as const)(
  'cancels a pending launch on %s',
  (testCase) => {
    mockRunMode = 'hold';
    render(<Playground />);

    fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
    if (testCase === 'switch') {
      fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
    }
    act(() => jest.advanceTimersByTime(0));

    expect(runEvents()).toEqual([]);
    expect(mockActiveListenerCount).toBe(0);
    expect(
      (
        screen.getByRole('button', {
          name: 'Run code',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  }
);

it('launches once and cleans up under StrictMode effect replay', () => {
  mockRunMode = 'hold';
  render(
    <React.StrictMode>
      <Playground />
    </React.StrictMode>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  act(() => jest.advanceTimersByTime(0));

  expect(runEvents()).toEqual(['run:@favy/di@3.0.0']);
  expect(mockActiveListenerCount).toBe(1);
  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect(mockActiveListenerCount).toBe(0);
});

it('restores selection and focus after a dependency remount', () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  editor().focus();
  editor().setSelectionRange(10, 20);

  act(() => jest.advanceTimersByTime(1000));
  act(() => jest.advanceTimersByTime(0));

  expect(document.activeElement).toBe(editor());
  expect(editor().selectionStart).toBe(10);
  expect(editor().selectionEnd).toBe(20);
});

it('flushes a pending scan, remounts, and runs exactly once', async () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  await act(async () => jest.runAllTimersAsync());

  const dependencyMount = 'mount:@favy/di@3.0.0|lodash@latest';
  const run = 'run:@favy/di@3.0.0|lodash@latest';
  expect(mockEvents.indexOf(dependencyMount)).toBeLessThan(
    mockEvents.indexOf(run)
  );
  expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([
    'run:@favy/di@3.0.0|lodash@latest',
  ]);
  expect(mockMaximumMountedProviders).toBe(1);
});

it.each([{ key: 'Control' }, { key: 'Meta' }])(
  'runs with $key+Enter',
  async ({ key }) => {
    render(<Playground />);
    const shortcut = {
      key: 'Enter',
      ctrlKey: key === 'Control',
      metaKey: key === 'Meta',
    };

    fireEvent.keyDown(editor(), shortcut);
    fireEvent.keyDown(editor(), shortcut);
    await act(async () => jest.runAllTimersAsync());

    expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([
      'run:@favy/di@3.0.0',
    ]);
  }
);
