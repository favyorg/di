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
  | {
      type: 'action';
      action: 'show-error';
      title?: string;
      message?: string;
    }
  | {
      type: 'action';
      action: 'notification';
      notificationType: 'error';
      title: string;
    }
  | {
      type: 'dependencies';
      data:
        | { state: 'downloading_manifest' }
        | { state: 'starting' }
        | {
            state: 'downloaded_module';
            name: string;
            total: number;
            progress: number;
          };
    }
  | {
      type: 'shell/progress';
      data: { state: 'starting_command' | 'command_running' };
    }
  | {
      type: 'console';
      codesandbox: true;
      log: Array<{
        method: 'log' | 'debug' | 'clear';
        id: string;
        data: unknown[];
      }>;
    };

type MockSandpackContext = {
  code: string;
  setCode(code: string, shouldUpdatePreview?: boolean): void;
  client: {
    readonly sandboxSetup: any;
    updateSandbox(nextSetup: any): void;
  };
  listen(listener: (message: MockSandpackMessage) => void): () => void;
};

let mockEvents: string[] = [];
let mockMountedProviders = 0;
let mockMaximumMountedProviders = 0;
let mockMountedClients = 0;
let mockMaximumMountedClients = 0;
let mockClientReady = false;
let mockClientNullReads = 0;
let mockUpdateMode: 'auto-done' | 'hold' | 'reject' = 'auto-done';
let mockProviderProps: any[] = [];
let mockUpdatedSetups: any[] = [];
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

  const codeFor = (file: string | { code: string }): string =>
    typeof file === 'string' ? file : file.code;

  const SandpackProvider = ({
    children,
    customSetup,
    files,
    options,
    template,
  }: any) => {
    const signature = signatureFor(customSetup.dependencies);
    const [code, setCode] = React.useState(codeFor(files['/index.ts']));
    const [hookIdentity, setHookIdentity] = React.useState(0);
    const listeners = React.useRef(new Set<(mockMessage: any) => void>());
    const sandboxSetup = React.useRef({
      ...customSetup,
      files: Object.fromEntries(
        Object.entries(files).map(([path, file]) => [
          path,
          typeof file === 'string' ? { code: file } : file,
        ])
      ),
      template,
    });
    const emit = React.useCallback((mockMessage: MockSandpackMessage): void => {
      listeners.current.forEach((listener) => listener(mockMessage));
    }, []);
    const client = React.useMemo(
      () => ({
        get sandboxSetup() {
          return sandboxSetup.current;
        },
        updateSandbox(nextSetup: any): void {
          if (mockUpdateMode === 'reject') {
            throw new Error('Mock Sandpack update failed');
          }
          sandboxSetup.current = nextSetup;
          mockUpdatedSetups.push(nextSetup);
          const runner = codeFor(nextSetup.files['/runner.ts']);
          mockEvents.push(`update:${signature}:${runner}`);
          if (mockUpdateMode !== 'auto-done') return;
          const token = /\/execution\.ts\?run=(\d+)/.exec(runner)?.[1];
          if (!token) return;
          setTimeout(() => {
            emit({
              type: 'console',
              codesandbox: true,
              log: [
                {
                  method: 'debug',
                  id: `complete:${token}`,
                  data: [`__FAVY_PLAYGROUND_DONE__:${token}`],
                },
              ],
            });
          }, 0);
        },
      }),
      [emit, signature]
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
        emit(mockMessage);
      };
      mockMountedProviders += 1;
      mockMaximumMountedProviders = Math.max(
        mockMaximumMountedProviders,
        mockMountedProviders
      );
      mockEvents.push(`mount:${signature}`);
      mockProviderProps.push({ customSetup, files, options });
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
    }, [changeHookIdentities, emit, signature]);

    const value = React.useMemo(
      () => ({ client, code, setCode, listen }),
      [client, code, listen]
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

  return {
    SandpackCodeEditor,
    SandpackProvider,
    useActiveCode: () => {
      const context = useMockSandpack();
      return {
        code: context.code,
        readOnly: false,
        updateCode: context.setCode,
      };
    },
    useSandpackClient: () => {
      const context = useMockSandpack();
      const iframe = React.useRef<HTMLIFrameElement | null>(null);
      React.useEffect(() => {
        mockMountedClients += 1;
        mockMaximumMountedClients = Math.max(
          mockMaximumMountedClients,
          mockMountedClients
        );
        return () => {
          mockMountedClients -= 1;
        };
      }, []);
      return {
        iframe,
        getClient: () => {
          if (!mockClientReady) return null;
          if (mockClientNullReads > 0) {
            mockClientNullReads -= 1;
            return null;
          }
          return context.client;
        },
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

const mountEvents = (): string[] =>
  mockEvents.filter((event) => event.startsWith('mount:'));

const updateEvents = (): string[] =>
  mockEvents.filter((event) => event.startsWith('update:'));

const emitSandpackMessage = (message: MockSandpackMessage): void => {
  act(() => {
    if (!mockEmitMessage) throw new Error('No mounted Sandpack provider');
    mockEmitMessage(message);
  });
};

const emitConsole = (method: 'log' | 'debug', value: unknown): void =>
  emitSandpackMessage({
    type: 'console',
    codesandbox: true,
    log: [{ method, id: `${method}:${String(value)}`, data: [value] }],
  });

const renderReadyPlayground = (): void => {
  render(<Playground />);
  mockClientReady = true;
  emitSandpackMessage({ type: 'done', compilatonError: false });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockEvents = [];
  mockMountedProviders = 0;
  mockMaximumMountedProviders = 0;
  mockMountedClients = 0;
  mockMaximumMountedClients = 0;
  mockClientReady = false;
  mockClientNullReads = 0;
  mockUpdateMode = 'auto-done';
  mockProviderProps = [];
  mockUpdatedSetups = [];
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
  renderReadyPlayground();

  expect(
    screen.getByRole('navigation', { name: 'Playground examples' })
  ).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Example' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset example' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Run code' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Ready');
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
  expect(screen.getByRole('region', { name: 'Console output' })).toBeTruthy();
  expect(
    document.querySelectorAll('iframe[title="Playground runtime"]')
  ).toHaveLength(1);
  expect(mockMaximumMountedClients).toBe(1);
});

it('prewarms dependencies through hidden runner files', () => {
  render(<Playground />);

  const { customSetup, files, options } = mockProviderProps[0];
  expect(customSetup.entry).toBe('/runner.ts');
  expect(options).toEqual({
    activeFile: '/index.ts',
    autorun: true,
    autoReload: false,
  });
  expect(files['/index.ts']).toEqual({
    code: playgroundExampleById.basic.source,
    active: true,
  });
  expect(files['/execution.ts']).toEqual({ code: '', hidden: true });
  expect(files['/runner.ts']).toEqual({
    code: 'import "@favy/di";',
    hidden: true,
  });
  expect(files['/index.html']).toEqual({
    code: '<!doctype html><script type="module" src="/runner.ts"></script>',
    hidden: true,
  });
});

it('shows console messages from the active browser run', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  emitConsole('log', 'Hello, Ada!');

  expect(screen.getByRole('log').textContent).toContain('Hello, Ada!');
});

it('renders non-JSON console values without breaking the playground', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  renderReadyPlayground();

  emitSandpackMessage({
    type: 'console',
    codesandbox: true,
    log: [
      {
        method: 'log',
        id: 'complex',
        data: [1n, circular],
      },
    ],
  });

  expect(screen.getByRole('log').textContent).toContain('1 [object Object]');
});

it('marks the controls busy while a run is active', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();

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
  mockClientReady = true;
  render(
    <React.StrictMode>
      <Playground />
    </React.StrictMode>
  );
  emitSandpackMessage({ type: 'done', compilatonError: false });

  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(updateEvents()).toEqual([]);
  expect(mockMaximumMountedClients).toBe(1);
  expect(mockActiveListenerCount).toBe(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps one provider across same-dependency switch and reset', () => {
  render(<Playground />);
  const mounts = mountEvents();
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(playgroundExampleById.composition.source);
  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));
  expect(editor().value).toBe(playgroundExampleById.basic.source);
  expect(mountEvents()).toEqual(mounts);
  expect(mockMaximumMountedProviders).toBe(1);
});

it('restores drafts and resets only the active example without running', () => {
  renderReadyPlayground();
  const basicSource = playgroundExampleById.basic.source;
  const compositionSource = playgroundExampleById.composition.source;
  const basicDraft = `${basicSource}\n// Basic draft`;
  const compositionDraft = `${compositionSource}\n// Composition draft`;

  fireEvent.change(editor(), { target: { value: basicDraft } });
  emitConsole('log', 'old output');
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionSource);
  expect(screen.getByRole('log').textContent).not.toContain('old output');

  fireEvent.change(editor(), { target: { value: compositionDraft } });
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));
  expect(editor().value).toBe(basicDraft);

  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  expect(editor().value).toBe(basicSource);

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionDraft);
  expect(updateEvents()).toEqual([]);
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
  expect(mockMaximumMountedClients).toBe(1);
});

it('keeps the last valid dependency generation for an incomplete import', () => {
  render(<Playground />);

  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport value from '`,
    },
  });
  act(() => jest.advanceTimersByTime(1000));

  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(mockMountedProviders).toBe(1);
  expect(mockMountedClients).toBe(1);
});

it.each([
  ['incomplete', "import value from '"],
  ['malformed', "import { value as } from 'lodash';"],
])('does not run when the immediate import scan is %s', async (_, source) => {
  renderReadyPlayground();
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\n${source}`,
    },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  await act(async () => jest.runAllTimersAsync());

  expect(updateEvents()).toEqual([]);
  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(screen.getByRole('status').textContent).toBe('Checking imports');
});

it('queues once during preparation and launches when ready', () => {
  render(<Playground />);
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  expect(screen.getByRole('status').textContent).toBe('Preparing runtime');
  expect(updateEvents()).toEqual([]);
  mockClientReady = true;
  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect(updateEvents()).toHaveLength(1);
  expect(updateEvents()[0]).toContain('/execution.ts?run=1');
});

it('times out a queued run when the runtime never becomes ready', async () => {
  render(<Playground />);
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  await act(async () => jest.advanceTimersByTimeAsync(30_000));

  expect(updateEvents()).toEqual([]);
  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(mockActiveListenerCount).toBe(1);
  expect(jest.getTimerCount()).toBe(0);

  mockClientReady = true;
  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect(updateEvents()).toEqual([]);
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
});

it('launches the source snapshot captured by an early run', () => {
  mockUpdateMode = 'hold';
  render(<Playground />);
  const queuedSource = `${playgroundExampleById.basic.source}\n// queued`;
  const laterSource = `${playgroundExampleById.basic.source}\n// later edit`;
  fireEvent.change(editor(), { target: { value: queuedSource } });
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  fireEvent.change(editor(), { target: { value: laterSource } });

  mockClientReady = true;
  emitSandpackMessage({ type: 'done', compilatonError: false });

  expect(mockUpdatedSetups[0].files['/execution.ts'].code).toContain(
    queuedSource
  );
  expect(mockUpdatedSetups[0].files['/execution.ts'].code).not.toContain(
    '// later edit'
  );
});

it('retries once when readiness precedes client registration', () => {
  render(<Playground />);
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  mockClientReady = true;
  mockClientNullReads = 1;

  emitSandpackMessage({ type: 'done', compilatonError: false });
  expect(updateEvents()).toEqual([]);
  expect(screen.getByRole('status').textContent).toBe('Preparing runtime');

  act(() => jest.advanceTimersByTime(0));
  expect(updateEvents()).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('Running');
});

it('ignores stale markers and hides the matching marker', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:999');
  expect(screen.getByRole('status').textContent).toBe('Running');
  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(screen.getByRole('log').textContent).not.toContain(
    '__FAVY_PLAYGROUND_DONE__'
  );
});

it.each([
  [
    { type: 'dependencies', data: { state: 'downloading_manifest' } },
    'Downloading packages',
  ],
  [
    { type: 'dependencies', data: { state: 'starting' } },
    'Installing packages',
  ],
  [
    { type: 'shell/progress', data: { state: 'starting_command' } },
    'Starting Vite',
  ],
] as const)('reports runtime preparation progress', (message, label) => {
  render(<Playground />);

  emitSandpackMessage(message);

  expect(screen.getByRole('status').textContent).toBe(label);
});

it('shows runtime preparation errors', () => {
  render(<Playground />);

  emitSandpackMessage({
    type: 'action',
    action: 'notification',
    notificationType: 'error',
    title: 'Dependency installation failed',
  });

  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect(screen.getByRole('log').textContent).toContain(
    'Dependency installation failed'
  );
});

it('lets Sandpack report syntax errors outside import declarations', async () => {
  renderReadyPlayground();
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nconst broken = ;`,
    },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  await act(async () => jest.runAllTimersAsync());

  expect(updateEvents()).toHaveLength(1);
});

it('keeps Run busy after show-error and an edit until that run settles', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  expect(updateEvents()).toHaveLength(1);
  expect((runButton as HTMLButtonElement).disabled).toBe(true);

  emitSandpackMessage({
    type: 'action',
    action: 'show-error',
    title: 'Runtime error',
    message: 'Broken execution',
  });
  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect(screen.getByRole('log').textContent).toContain('Broken execution');
  expect((runButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(editor(), {
    target: { value: `${playgroundExampleById.basic.source}\n// Edited` },
  });
  fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
  expect(screen.getByRole('status').textContent).toBe('Checking imports');
  expect((runButton as HTMLButtonElement).disabled).toBe(true);
  expect(updateEvents()).toHaveLength(1);

  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('status').textContent).toBe('Checking imports');

  act(() => jest.advanceTimersByTime(1_000));
  expect(screen.getByRole('status').textContent).toBe('Ready');
});

it('defers a matured dependency remount until the active run settles', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  act(() => jest.advanceTimersByTime(1_000));

  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(updateEvents()).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('Checking imports');

  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');

  expect(mountEvents()).toEqual([
    'mount:@favy/di@3.0.0',
    'mount:@favy/di@3.0.0|lodash@latest',
  ]);
  expect(updateEvents()).toHaveLength(1);
  expect(mockMaximumMountedProviders).toBe(1);
});

it('keeps the scoped listener when hook callback identities change', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  expect(mockActiveListenerCount).toBe(1);

  act(() => {
    if (!mockChangeHookIdentities) {
      throw new Error('No mounted Sandpack provider');
    }
    mockChangeHookIdentities();
  });

  expect(mockActiveListenerCount).toBe(1);
  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(mockActiveListenerCount).toBe(1);
});

it('settles a compilation failure and clears its timeout', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  const runButton = screen.getByRole('button', { name: 'Run code' });

  fireEvent.click(runButton);
  expect(mockActiveListenerCount).toBe(1);

  emitSandpackMessage({ type: 'done', compilatonError: true });

  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect((runButton as HTMLButtonElement).disabled).toBe(false);
  expect(mockActiveListenerCount).toBe(1);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([
  {
    outcome: 'synchronous update failure',
    mode: 'reject' as const,
    elapsed: 0,
    updates: 0,
  },
  {
    outcome: '30-second timeout',
    mode: 'hold' as const,
    elapsed: 30_000,
    updates: 1,
  },
])(
  'settles a $outcome and clears its timeout',
  async ({ mode, elapsed, updates }) => {
    mockUpdateMode = mode;
    renderReadyPlayground();
    const runButton = screen.getByRole('button', { name: 'Run code' });

    fireEvent.click(runButton);
    await act(async () => jest.advanceTimersByTimeAsync(elapsed));

    expect(updateEvents()).toHaveLength(updates);
    expect(screen.getByRole('status').textContent).toBe('Failed');
    expect((runButton as HTMLButtonElement).disabled).toBe(false);
    expect(mockActiveListenerCount).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  }
);

it.each(['switch', 'reset'] as const)(
  'cancels a queued run on %s',
  (testCase) => {
    mockUpdateMode = 'hold';
    render(<Playground />);

    fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
    if (testCase === 'switch') {
      fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
    }
    mockClientReady = true;
    emitSandpackMessage({ type: 'done', compilatonError: false });

    expect(updateEvents()).toEqual([]);
    expect(mockActiveListenerCount).toBe(1);
    expect(
      (
        screen.getByRole('button', {
          name: 'Run code',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  }
);

it('suppresses cancelled output until the displayed code launches', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  const runButton = screen.getByRole('button', { name: 'Run code' });
  fireEvent.click(runButton);

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  emitConsole('log', 'late basic output');
  expect(screen.getByRole('log').textContent).not.toContain(
    'late basic output'
  );

  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect(screen.getByRole('status').textContent).toBe('Ready');
  emitConsole('log', 'late basic output after marker');
  expect(screen.getByRole('log').textContent).not.toContain(
    'late basic output after marker'
  );

  fireEvent.click(runButton);
  emitConsole('log', 'composition output');
  expect(screen.getByRole('log').textContent).toContain('composition output');
});

it.each(['switch', 'reset'] as const)(
  'keeps old output hidden after the cancelled marker on %s',
  (testCase) => {
    mockUpdateMode = 'hold';
    renderReadyPlayground();
    fireEvent.click(screen.getByRole('button', { name: 'Run code' }));

    if (testCase === 'switch') {
      fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
    }
    emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
    emitConsole('log', `late output after ${testCase}`);

    expect(screen.getByRole('log').textContent).not.toContain(
      `late output after ${testCase}`
    );
  }
);

it('queues a new run until the cancelled run settles', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  expect(updateEvents()).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('Preparing runtime');

  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect(updateEvents()).toHaveLength(2);
  expect(updateEvents()[1]).toContain('/execution.ts?run=2');
});

it('preserves import scanning when a cancelled run settles', () => {
  mockUpdateMode = 'hold';
  renderReadyPlayground();
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  fireEvent.change(editor(), {
    target: { value: `${playgroundExampleById.composition.source}\n// edit` },
  });
  expect(screen.getByRole('status').textContent).toBe('Checking imports');

  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');

  expect(screen.getByRole('status').textContent).toBe('Checking imports');
});

it('launches once under StrictMode effect replay', () => {
  mockUpdateMode = 'hold';
  mockClientReady = true;
  render(
    <React.StrictMode>
      <Playground />
    </React.StrictMode>
  );
  emitSandpackMessage({ type: 'done', compilatonError: false });

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));

  expect(updateEvents()).toHaveLength(1);
  expect(mockActiveListenerCount).toBe(1);
  emitConsole('debug', '__FAVY_PLAYGROUND_DONE__:1');
  expect(mockActiveListenerCount).toBe(1);
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
  renderReadyPlayground();
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));

  expect(updateEvents()).toEqual([]);
  mockClientReady = true;
  emitSandpackMessage({ type: 'done', compilatonError: false });
  await act(async () => jest.runAllTimersAsync());

  const dependencyMount = 'mount:@favy/di@3.0.0|lodash@latest';
  expect(mockEvents.indexOf(dependencyMount)).toBeLessThan(
    mockEvents.findIndex((event) => event.startsWith('update:'))
  );
  expect(updateEvents()).toHaveLength(1);
  expect(updateEvents()[0]).toContain('@favy/di@3.0.0|lodash@latest');
  expect(mockMaximumMountedProviders).toBe(1);
});

it.each([{ key: 'Control' }, { key: 'Meta' }])(
  'runs with $key+Enter',
  async ({ key }) => {
    renderReadyPlayground();
    const shortcut = {
      key: 'Enter',
      ctrlKey: key === 'Control',
      metaKey: key === 'Meta',
    };

    fireEvent.keyDown(editor(), shortcut);
    fireEvent.keyDown(editor(), shortcut);
    await act(async () => jest.runAllTimersAsync());

    expect(updateEvents()).toHaveLength(1);
  }
);
