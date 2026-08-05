import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import {
  PlaygroundSandbox,
  type PlaygroundRunRequest,
  type PlaygroundSandboxProps,
} from '../src/components/playground/playground-sandbox';

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

type MockSandpackMessage =
  | { type: 'done'; compilatonError: boolean }
  | { type: 'fs/change'; path: string; content: string }
  | {
      type: 'console';
      codesandbox: true;
      log: Array<{ method: 'debug'; id: string; data: unknown[] }>;
    };

type MockProviderProps = Readonly<{
  children: ReactNode;
  customSetup: { entry: string; dependencies: Record<string, string> };
  files: Record<
    string,
    string | { code: string; hidden?: boolean; active?: boolean }
  >;
  options: Record<string, unknown>;
  template: string;
  theme: string;
}>;

let mockProviderProps: MockProviderProps[] = [];
let mockRuntimeCommands: unknown[] = [];
let mockUpdatedSetups: any[] = [];
let mockEmitSandpack: ((message: MockSandpackMessage) => void) | undefined;
let mockMountedProviders = 0;
let mockMountedControllers = 0;
let mockListenCalls = 0;
let mockActiveListeners = 0;

jest.mock('@codesandbox/sandpack-react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const SandpackContext = React.createContext<any>(null);

  const SandpackProvider = (props: any) => {
    const { children, customSetup, files, template } = props;
    mockProviderProps.push(props);
    const listeners = React.useRef(new Set<any>());
    const setup = React.useRef({
      ...customSetup,
      files: Object.fromEntries(
        Object.entries(files).map(([path, file]) => [
          path,
          typeof file === 'string' ? { code: file } : file,
        ])
      ),
      template,
    });
    const client = React.useMemo(
      () => ({
        get sandboxSetup() {
          return setup.current;
        },
        updateSandbox(nextSetup: any): void {
          setup.current = nextSetup;
          mockUpdatedSetups.push(nextSetup);
        },
      }),
      []
    );
    const listen = React.useCallback(
      (listener: (message: MockSandpackMessage) => void) => {
        mockListenCalls += 1;
        listeners.current.add(listener);
        mockActiveListeners += 1;
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          if (listeners.current.delete(listener)) mockActiveListeners -= 1;
        };
      },
      []
    );
    const emit = React.useCallback((message: any) => {
      listeners.current.forEach((listener) => listener(message));
    }, []);
    const value = React.useMemo(() => ({ client, listen }), [client, listen]);

    React.useEffect(() => {
      mockMountedProviders += 1;
      mockEmitSandpack = emit;
      return () => {
        mockMountedProviders -= 1;
        if (mockEmitSandpack === emit) mockEmitSandpack = undefined;
        mockActiveListeners -= listeners.current.size;
        listeners.current.clear();
      };
    }, [emit]);

    return (
      <SandpackContext.Provider value={value}>
        {children}
      </SandpackContext.Provider>
    );
  };

  const useSandpackClient = () => {
    const context = React.useContext(SandpackContext);
    if (!context) throw new Error('Missing mocked SandpackProvider.');
    const iframe = React.useRef<HTMLIFrameElement | null>(null);

    React.useEffect(() => {
      mockMountedControllers += 1;
      const runtime = iframe.current?.contentWindow;
      if (!runtime) throw new Error('Controller did not render its iframe.');
      const postMessage = runtime.postMessage;
      runtime.postMessage = (message: unknown): void => {
        mockRuntimeCommands.push(message);
      };
      return () => {
        mockMountedControllers -= 1;
        runtime.postMessage = postMessage;
      };
    }, []);

    return {
      iframe,
      getClient: () => context.client,
      listen: (listener: (message: MockSandpackMessage) => void) =>
        context.listen(listener),
    };
  };

  return { SandpackProvider, useSandpackClient };
});

const request = (
  runToken: number,
  sandboxKey = 'favy-local|lodash-latest'
): PlaygroundRunRequest => ({
  runToken,
  sandboxKey,
  code: `console.log(${runToken});`,
});

const callbacks = () => ({
  onReady: jest.fn(),
  onPhaseChange: jest.fn(),
  onOutput: jest.fn(),
  onSettled: jest.fn(),
  onStatus: jest.fn(),
});

const renderSandbox = (overrides: Partial<PlaygroundSandboxProps> = {}) => {
  const handlers = callbacks();
  const props: PlaygroundSandboxProps = {
    sandboxKey: 'favy-local|lodash-latest',
    dependencies: { '@favy/di': 'local', lodash: 'latest' },
    initialCode: 'console.log("initial");',
    theme: 'light',
    runRequest: null,
    cancelRunToken: null,
    ...handlers,
    ...overrides,
  };
  const view = render(
    <PlaygroundSandbox {...props}>
      <textarea aria-label="Visible editor" defaultValue="draft" />
      <span>Visible workspace</span>
    </PlaygroundSandbox>
  );
  return { ...view, handlers, props };
};

const emitSandpack = (message: MockSandpackMessage): void => {
  act(() => {
    if (!mockEmitSandpack) throw new Error('No mounted Sandpack provider.');
    mockEmitSandpack(message);
  });
};

const emitRuntimeRelay = (relay: Record<string, unknown>): void =>
  emitSandpack({
    type: 'console',
    codesandbox: true,
    log: [
      {
        method: 'debug',
        id: JSON.stringify(relay),
        data: ['__FAVY_PLAYGROUND_RELAY__', relay],
      },
    ],
  });

const lastRuntimeCommand = (): any => mockRuntimeCommands.at(-1);

const activeSessionToken = (): number => {
  const command = mockRuntimeCommands
    .filter((candidate: any) => candidate?.action === 'prepare')
    .at(-1) as { sessionToken?: unknown } | undefined;
  if (typeof command?.sessionToken !== 'number') {
    throw new Error('No prepared runtime session.');
  }
  return command.sessionToken;
};

const firstSessionToken = (): number => {
  const command = mockRuntimeCommands.find(
    (candidate: any) => candidate?.action === 'prepare'
  ) as { sessionToken?: unknown } | undefined;
  if (typeof command?.sessionToken !== 'number') {
    throw new Error('No prepared runtime session.');
  }
  return command.sessionToken;
};

const updatedExecution = (): string => {
  const code = mockUpdatedSetups.at(-1)?.files['/execution.ts']?.code;
  if (typeof code !== 'string') throw new Error('No execution update.');
  return code;
};

const updatedExecutions = (): string[] =>
  mockUpdatedSetups.map((setup) => setup.files['/execution.ts']?.code);

const bootRuntime = (): void =>
  emitSandpack({ type: 'done', compilatonError: false });

const emitRuntimeReady = (sessionToken = activeSessionToken()): void =>
  emitRuntimeRelay({ kind: 'ready', sessionToken });

const acknowledgeExecutionWrite = (): void =>
  emitSandpack({
    type: 'fs/change',
    path: '/execution.ts',
    content: updatedExecution(),
  });

beforeEach(() => {
  jest.useFakeTimers();
  mockProviderProps = [];
  mockRuntimeCommands = [];
  mockUpdatedSetups = [];
  mockEmitSandpack = undefined;
  mockMountedProviders = 0;
  mockMountedControllers = 0;
  mockListenCalls = 0;
  mockActiveListeners = 0;
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('prepares one session and runs only after its exact write acknowledgement', () => {
  const { handlers } = renderSandbox({ runRequest: request(7) });

  emitSandpack({ type: 'done', compilatonError: true });
  expect(mockRuntimeCommands).toEqual([]);
  emitSandpack({ type: 'done', compilatonError: false });
  expect(lastRuntimeCommand()).toMatchObject({
    action: 'prepare',
    sessionToken: expect.any(Number),
  });

  emitRuntimeRelay({
    kind: 'ready',
    sessionToken: activeSessionToken() + 1,
  });
  expect(mockUpdatedSetups).toEqual([]);
  emitRuntimeRelay({ kind: 'ready', sessionToken: activeSessionToken() });
  expect(updatedExecution()).toContain('// run:7');
  expect(handlers.onStatus).toHaveBeenLastCalledWith('Preparing runtime');
  expect(handlers.onOutput).toHaveBeenCalledWith({
    type: 'reset',
    runToken: 7,
  });

  emitSandpack({
    type: 'fs/change',
    path: '/runner.ts',
    content: updatedExecution(),
  });
  emitSandpack({
    type: 'fs/change',
    path: '/execution.ts',
    content: `${updatedExecution()}// stale`,
  });
  expect(mockRuntimeCommands).toHaveLength(1);

  acknowledgeExecutionWrite();
  expect(lastRuntimeCommand()).toEqual({
    type: '__FAVY_PLAYGROUND_RUNTIME__',
    action: 'run',
    sessionToken: activeSessionToken(),
    runToken: 7,
  });
  expect(handlers.onPhaseChange.mock.calls).toEqual([
    [7, 'queued'],
    [7, 'committing'],
    [7, 'executing'],
  ]);

  emitSandpack({ type: 'done', compilatonError: false });
  acknowledgeExecutionWrite();
  expect(mockRuntimeCommands).toHaveLength(2);
  expect(
    mockRuntimeCommands.filter((command: any) => command.action === 'prepare')
  ).toHaveLength(1);
});

it('creates isolated runtime files and installs registry dependencies only', () => {
  renderSandbox();

  expect(screen.getByText('Visible workspace')).toBeTruthy();
  expect(mockMountedProviders).toBe(1);
  expect(mockMountedControllers).toBe(1);
  const { customSetup, files, options, template, theme } = mockProviderProps.at(
    -1
  ) as MockProviderProps;
  expect(template).toBe('vite');
  expect(theme).toBe('light');
  expect(customSetup).toEqual({
    entry: '/runner.ts',
    dependencies: { lodash: 'latest' },
  });
  expect(options).toEqual({
    activeFile: '/index.ts',
    autorun: true,
    autoReload: false,
  });
  expect(files['/index.ts']).toEqual({
    code: 'console.log("initial");',
    active: true,
  });
  expect(files['/execution.ts']).toEqual({ code: '', hidden: true });
  expect((files['/runner.ts'] as { code: string }).code).not.toMatch(
    /^\s*import\s/m
  );
  expect(files['/warmup.ts']).toEqual({
    code: 'import "@favy/di";\nimport "lodash";',
    hidden: true,
  });
  expect((files['/frame.html'] as { code: string }).code).toContain(
    '<script type="module">'
  );
  expect((files['/frame.html'] as { code: string }).code).toContain(
    "'/warmup.ts'"
  );
  expect(files['/favy-di/index.ts']).toEqual({
    code: 'export const Module = {};',
    hidden: true,
  });
  expect(files['/favy-di/lib/hkt.ts']).toEqual({
    code: 'export type HKT = unknown;',
    hidden: true,
  });
  expect(files['/favy-di/lib/makeModule.ts']).toEqual({
    code: 'export const makeModule = {};',
    hidden: true,
  });
  expect(files['/favy-di/lib/module.ts']).toEqual({
    code: 'export const module = {};',
    hidden: true,
  });
  expect((files['/vite.config.js'] as { code: string }).code).toContain(
    'find: /^@favy\\/di$/'
  );
  expect((files['/vite.config.js'] as { code: string }).code).toContain(
    "cors: { origin: '*' }"
  );
  expect((files['/vite.config.js'] as { code: string }).code).toContain(
    'hmr: false'
  );
});

it('forwards matching run output and settles a failed run once', () => {
  const { handlers } = renderSandbox({ runRequest: request(9) });
  emitSandpack({ type: 'done', compilatonError: false });
  emitRuntimeRelay({ kind: 'ready', sessionToken: activeSessionToken() });
  acknowledgeExecutionWrite();

  emitRuntimeRelay({
    kind: 'output',
    sessionToken: activeSessionToken() + 1,
    runToken: 9,
    eventId: 0,
    method: 'log',
    data: ['wrong session'],
  });
  emitRuntimeRelay({
    kind: 'output',
    sessionToken: activeSessionToken(),
    runToken: 8,
    eventId: 0,
    method: 'log',
    data: ['wrong run'],
  });
  emitRuntimeRelay({
    kind: 'output',
    sessionToken: activeSessionToken(),
    runToken: 9,
    eventId: 0,
    method: 'log',
    data: ['visible', 42],
  });
  emitRuntimeRelay({
    kind: 'output',
    sessionToken: activeSessionToken(),
    runToken: 9,
    eventId: 1,
    method: 'clear',
    data: [],
  });
  emitRuntimeRelay({
    kind: 'error',
    sessionToken: activeSessionToken(),
    runToken: 9,
    eventId: 2,
    error: 'Error: boom',
  });
  emitRuntimeRelay({
    kind: 'complete',
    sessionToken: activeSessionToken(),
    runToken: 9,
  });
  emitRuntimeRelay({
    kind: 'complete',
    sessionToken: activeSessionToken(),
    runToken: 9,
  });

  expect(handlers.onOutput.mock.calls.map(([update]) => update)).toEqual([
    { type: 'reset', runToken: 9 },
    { type: 'append', runToken: 9, method: 'log', data: ['visible', 42] },
    { type: 'clear', runToken: 9 },
    {
      type: 'append',
      runToken: 9,
      method: 'error',
      data: ['Error: boom'],
    },
  ]);
  expect(handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(handlers.onSettled).toHaveBeenCalledWith({
    runToken: 9,
    outcome: 'completed',
    failed: true,
  });
  expect(handlers.onStatus).toHaveBeenLastCalledWith('Failed');
  expect(handlers.onStatus.mock.invocationCallOrder.at(-1)).toBeLessThan(
    handlers.onSettled.mock.invocationCallOrder[0]
  );
});

it('leaves a request queued for the dependency session it targets', () => {
  const { handlers } = renderSandbox({
    runRequest: request(7, 'replacement-session'),
  });

  emitSandpack({ type: 'done', compilatonError: false });
  emitRuntimeRelay({ kind: 'ready', sessionToken: activeSessionToken() });

  expect(mockUpdatedSetups).toEqual([]);
  expect(handlers.onPhaseChange).not.toHaveBeenCalled();
  expect(handlers.onSettled).not.toHaveBeenCalled();
});

it('never reuses a session token when a dependency provider is replaced', () => {
  const first = renderSandbox();
  emitSandpack({ type: 'done', compilatonError: false });
  const firstToken = activeSessionToken();
  first.unmount();
  mockRuntimeCommands = [];

  renderSandbox({ sandboxKey: 'replacement-session' });
  emitSandpack({ type: 'done', compilatonError: false });

  expect(activeSessionToken()).toBeGreaterThan(firstToken);
});

it('reuses the prepared controller iframe across completed runs', () => {
  const handlers = callbacks();
  const props: PlaygroundSandboxProps = {
    sandboxKey: 'favy-local|lodash-latest',
    dependencies: { '@favy/di': 'local', lodash: 'latest' },
    initialCode: 'console.log("initial");',
    theme: 'light',
    runRequest: request(1),
    cancelRunToken: null,
    ...handlers,
  };
  const view = render(<PlaygroundSandbox {...props} />);
  const runtime = document.querySelector('iframe.playground__runtime-client');
  emitSandpack({ type: 'done', compilatonError: false });
  const preparedSession = activeSessionToken();
  emitRuntimeRelay({ kind: 'ready', sessionToken: preparedSession });
  acknowledgeExecutionWrite();
  emitRuntimeRelay({
    kind: 'complete',
    sessionToken: preparedSession,
    runToken: 1,
  });

  view.rerender(<PlaygroundSandbox {...props} runRequest={request(2)} />);
  expect(updatedExecution()).toContain('// run:2');
  acknowledgeExecutionWrite();

  expect(document.querySelector('iframe.playground__runtime-client')).toBe(
    runtime
  );
  expect(
    mockRuntimeCommands.filter((command: any) => command.action === 'prepare')
  ).toHaveLength(1);
  expect(lastRuntimeCommand()).toEqual({
    type: '__FAVY_PLAYGROUND_RUNTIME__',
    action: 'run',
    sessionToken: preparedSession,
    runToken: 2,
  });
});

it('keeps one scoped listener when Sandpack hook wrappers change identity', () => {
  const handlers = callbacks();
  const props: PlaygroundSandboxProps = {
    sandboxKey: 'favy-local|lodash-latest',
    dependencies: { '@favy/di': 'local', lodash: 'latest' },
    initialCode: 'console.log("initial");',
    theme: 'light',
    runRequest: null,
    cancelRunToken: null,
    ...handlers,
  };
  const view = render(<PlaygroundSandbox {...props} />);
  expect(mockListenCalls).toBe(1);

  view.rerender(<PlaygroundSandbox {...props} theme="dark" />);

  expect(mockListenCalls).toBe(1);
  emitSandpack({ type: 'done', compilatonError: false });
  expect(lastRuntimeCommand()).toMatchObject({ action: 'prepare' });
});

it('keeps a cold request queued past 30 seconds and launches once when ready', () => {
  const { handlers } = renderSandbox({ runRequest: request(7) });
  bootRuntime();

  act(() => jest.advanceTimersByTime(31_000));

  expect(updatedExecutions()).toHaveLength(0);
  expect(handlers.onSettled).not.toHaveBeenCalled();

  emitRuntimeReady();

  expect(updatedExecutions()).toHaveLength(1);
});

it('retries the first preparation error and settles the second one unavailable', () => {
  const runRequest = request(7);
  const { handlers } = renderSandbox({ runRequest });
  bootRuntime();
  const firstToken = firstSessionToken();

  emitRuntimeRelay({
    kind: 'prepareError',
    sessionToken: firstToken,
    error: 'first preparation failed',
  });

  expect(handlers.onSettled).not.toHaveBeenCalled();
  bootRuntime();
  expect(activeSessionToken()).not.toBe(firstToken);

  emitRuntimeRelay({
    kind: 'prepareError',
    sessionToken: activeSessionToken(),
    error: 'second preparation failed',
  });

  expect(handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'runtime-unavailable',
  });
});

it('restarts at the exact 120-second preparation boundary with the same request', () => {
  const runRequest = request(7);
  const { handlers } = renderSandbox({ runRequest });
  bootRuntime();
  const firstToken = firstSessionToken();

  act(() => jest.advanceTimersByTime(119_999));
  expect(activeSessionToken()).toBe(firstToken);
  expect(handlers.onSettled).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(1));
  expect(handlers.onSettled).not.toHaveBeenCalled();
  bootRuntime();
  expect(activeSessionToken()).not.toBe(firstToken);

  emitRuntimeReady();
  acknowledgeExecutionWrite();
  expect(lastRuntimeCommand()).toMatchObject({
    action: 'run',
    runToken: runRequest.runToken,
  });
});

it('uses one shared retry budget for preparation and commit failures', () => {
  const { handlers } = renderSandbox({ runRequest: request(7) });
  bootRuntime();
  emitRuntimeRelay({
    kind: 'prepareError',
    sessionToken: activeSessionToken(),
    error: 'preparation failed',
  });
  bootRuntime();
  emitRuntimeReady();

  act(() => jest.advanceTimersByTime(10_000));

  expect(handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'runtime-unavailable',
  });
});

it('restarts at the exact 10-second commit boundary', () => {
  const { handlers } = renderSandbox({ runRequest: request(7) });
  bootRuntime();
  emitRuntimeReady();
  const firstToken = firstSessionToken();

  act(() => jest.advanceTimersByTime(9_999));
  expect(activeSessionToken()).toBe(firstToken);
  expect(handlers.onSettled).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(1));
  expect(handlers.onSettled).not.toHaveBeenCalled();
  bootRuntime();
  expect(activeSessionToken()).not.toBe(firstToken);
});

it('ignores a stale execution write acknowledgement after a commit retry', () => {
  const { handlers } = renderSandbox({ runRequest: request(7) });
  bootRuntime();
  emitRuntimeReady();
  const staleExecution = updatedExecution();

  act(() => jest.advanceTimersByTime(10_000));
  bootRuntime();
  emitRuntimeReady();
  const retriedExecution = updatedExecution();
  expect(retriedExecution).not.toBe(staleExecution);

  emitSandpack({
    type: 'fs/change',
    path: '/execution.ts',
    content: staleExecution,
  });
  expect(lastRuntimeCommand()).toMatchObject({ action: 'prepare' });

  acknowledgeExecutionWrite();
  expect(lastRuntimeCommand()).toMatchObject({ action: 'run', runToken: 7 });
  expect(handlers.onSettled).not.toHaveBeenCalled();
});

it('restarts at 30 seconds of execution without retrying user code', () => {
  const runRequest = request(7);
  const { handlers } = renderSandbox({ runRequest });
  const editor = screen.getByRole('textbox', { name: 'Visible editor' });
  bootRuntime();
  emitRuntimeReady();
  acknowledgeExecutionWrite();
  const firstRuntime = document.querySelector(
    'iframe.playground__runtime-client'
  );

  act(() => jest.advanceTimersByTime(29_999));
  expect(handlers.onSettled).not.toHaveBeenCalled();
  expect(document.querySelector('iframe.playground__runtime-client')).toBe(
    firstRuntime
  );

  act(() => jest.advanceTimersByTime(1));
  expect(handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'runtime-restarted',
  });
  expect(document.querySelector('iframe.playground__runtime-client')).not.toBe(
    firstRuntime
  );
  expect(screen.getByRole('textbox', { name: 'Visible editor' })).toBe(editor);

  bootRuntime();
  emitRuntimeReady();
  expect(updatedExecutions()).toHaveLength(1);
  expect(
    mockRuntimeCommands.filter((command: any) => command.action === 'run')
  ).toHaveLength(1);
});

it('cancels a queued request locally and ignores later readiness', () => {
  const runRequest = request(7);
  const view = renderSandbox({ runRequest });
  bootRuntime();

  view.rerender(
    <PlaygroundSandbox {...view.props} cancelRunToken={7}>
      <span>Visible workspace</span>
    </PlaygroundSandbox>
  );

  expect(view.handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(view.handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'cancelled',
  });
  expect(lastRuntimeCommand()).toMatchObject({ action: 'prepare' });

  emitRuntimeReady();
  act(() => jest.advanceTimersByTime(120_000));
  expect(updatedExecutions()).toHaveLength(0);
  expect(view.handlers.onSettled).toHaveBeenCalledTimes(1);
});

it('cancels a committing request locally and ignores its late acknowledgement', () => {
  const runRequest = request(7);
  const view = renderSandbox({ runRequest });
  bootRuntime();
  emitRuntimeReady();

  view.rerender(
    <PlaygroundSandbox {...view.props} cancelRunToken={7}>
      <span>Visible workspace</span>
    </PlaygroundSandbox>
  );
  acknowledgeExecutionWrite();
  act(() => jest.advanceTimersByTime(10_000));

  expect(view.handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(view.handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'cancelled',
  });
  expect(
    mockRuntimeCommands.filter((command: any) => command.action === 'run')
  ).toHaveLength(0);
});

it('cancels execution only after the exact runtime acknowledgement', () => {
  const runRequest = request(7);
  const view = renderSandbox({ runRequest });
  bootRuntime();
  emitRuntimeReady();
  acknowledgeExecutionWrite();
  const preparedSession = activeSessionToken();
  const firstRuntime = document.querySelector(
    'iframe.playground__runtime-client'
  );

  view.rerender(
    <PlaygroundSandbox {...view.props} cancelRunToken={7}>
      <span>Visible workspace</span>
    </PlaygroundSandbox>
  );

  expect(lastRuntimeCommand()).toEqual({
    type: '__FAVY_PLAYGROUND_RUNTIME__',
    action: 'cancel',
    sessionToken: preparedSession,
    runToken: 7,
  });
  expect(view.handlers.onSettled).not.toHaveBeenCalled();

  emitRuntimeRelay({
    kind: 'cancelled',
    sessionToken: preparedSession + 1,
    runToken: 7,
  });
  emitRuntimeRelay({
    kind: 'cancelled',
    sessionToken: preparedSession,
    runToken: 8,
  });
  expect(view.handlers.onSettled).not.toHaveBeenCalled();

  emitRuntimeRelay({
    kind: 'cancelled',
    sessionToken: preparedSession,
    runToken: 7,
  });

  expect(view.handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(view.handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'cancelled',
  });
  expect(document.querySelector('iframe.playground__runtime-client')).toBe(
    firstRuntime
  );
  expect(jest.getTimerCount()).toBe(0);
});

it('remounts at the exact 1000 ms cancellation boundary when acknowledgement is missing', () => {
  const runRequest = request(7);
  const view = renderSandbox({ runRequest });
  bootRuntime();
  emitRuntimeReady();
  acknowledgeExecutionWrite();
  const firstRuntime = document.querySelector(
    'iframe.playground__runtime-client'
  );

  view.rerender(
    <PlaygroundSandbox {...view.props} cancelRunToken={7}>
      <span>Visible workspace</span>
    </PlaygroundSandbox>
  );
  const workspace = screen.getByText('Visible workspace');

  act(() => jest.advanceTimersByTime(999));
  expect(view.handlers.onSettled).not.toHaveBeenCalled();
  expect(document.querySelector('iframe.playground__runtime-client')).toBe(
    firstRuntime
  );

  act(() => jest.advanceTimersByTime(1));
  expect(view.handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(view.handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'cancelled',
  });
  expect(document.querySelector('iframe.playground__runtime-client')).not.toBe(
    firstRuntime
  );
  expect(screen.getByText('Visible workspace')).toBe(workspace);
});

it('settles cancellation once when completion races its acknowledgement', () => {
  const runRequest = request(7);
  const view = renderSandbox({ runRequest });
  bootRuntime();
  emitRuntimeReady();
  acknowledgeExecutionWrite();
  const preparedSession = activeSessionToken();

  view.rerender(
    <PlaygroundSandbox {...view.props} cancelRunToken={7}>
      <span>Visible workspace</span>
    </PlaygroundSandbox>
  );
  emitRuntimeRelay({
    kind: 'complete',
    sessionToken: preparedSession,
    runToken: 7,
  });
  emitRuntimeRelay({
    kind: 'cancelled',
    sessionToken: preparedSession,
    runToken: 7,
  });
  act(() => jest.advanceTimersByTime(1_000));

  expect(view.handlers.onSettled).toHaveBeenCalledTimes(1);
  expect(view.handlers.onSettled).toHaveBeenCalledWith({
    runToken: 7,
    outcome: 'cancelled',
  });
});

it('keeps one controller listener under StrictMode and clears every timer on cleanup', () => {
  const handlers = callbacks();
  const view = render(
    <StrictMode>
      <PlaygroundSandbox
        sandboxKey="favy-local|lodash-latest"
        dependencies={{ '@favy/di': 'local', lodash: 'latest' }}
        initialCode={'console.log("initial");'}
        theme="light"
        runRequest={request(7)}
        cancelRunToken={null}
        {...handlers}
      />
    </StrictMode>
  );

  expect(mockMountedProviders).toBe(1);
  expect(mockMountedControllers).toBe(1);
  expect(mockActiveListeners).toBe(1);
  expect(jest.getTimerCount()).toBe(1);

  view.unmount();

  expect(mockMountedProviders).toBe(0);
  expect(mockMountedControllers).toBe(0);
  expect(mockActiveListeners).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
