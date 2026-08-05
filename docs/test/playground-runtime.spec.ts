import path from 'node:path';
import type {
  SandboxSetup,
  SandpackMessage,
} from '@codesandbox/sandpack-client';
import ts from 'typescript';
import {
  isNpmPackageName,
  resolvePlaygroundDependencies,
} from '../src/components/playground/playground-dependencies';
import { playgroundExamples } from '../src/components/playground/playground-examples';
import {
  frameHtmlSource,
  preparationLabel,
  runtimeCancelCommand,
  runtimePrepareCommand,
  runtimeRelayRecord,
  runtimeRunCommand,
  runtimeSource,
  setupForRun,
  warmupSource,
  type PlaygroundConsoleValue,
  type RuntimeCommand,
  type RuntimeRelay,
} from '../src/components/playground/playground-runtime';

const MESSAGE_TYPE = '__FAVY_PLAYGROUND_RUNTIME__';
const WARMUP_SELECTOR = 'iframe[data-favy-playground-warmup]';
const EXECUTION_SELECTOR = 'iframe[data-favy-playground-execution]';
const workspace = path.resolve(__dirname, '../..');

const setup: SandboxSetup = {
  entry: '/runner.ts',
  template: 'node',
  dependencies: {},
  files: {
    '/index.ts': { code: 'console.log("old")', active: true },
    '/execution.ts': { code: 'export {};', hidden: true },
    '/runner.ts': { code: 'export {};', hidden: true },
  },
};

type ConsoleRecord = Readonly<{
  method?: unknown;
  data?: readonly unknown[];
}>;

type RuntimeWindow = Record<string, unknown> & {
  console: Console;
  addEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
};

type RunnerHarness = Readonly<{
  parent: object;
  consoleRecords: ConsoleRecord[];
  dispatch(command: unknown, source?: object): void;
  emit(frame: HTMLIFrameElement, relay: object): void;
  listenerCount(): number;
  relays(): RuntimeRelay[];
}>;

type BootstrapHarness = Readonly<{
  runtime: RuntimeWindow;
  imports: string[];
  messages: Array<Readonly<{ record: unknown; targetOrigin: string }>>;
}>;

const diagnosticsForExecution = (
  id: string,
  source: string
): readonly ts.Diagnostic[] => {
  const filename = path.join(
    workspace,
    'docs',
    'test',
    '__virtual__',
    `${id}-execution.ts`
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: workspace,
    paths: { '@favy/di': ['di/src/index.ts'] },
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists;
  const originalReadFile = host.readFile;
  const originalGetSourceFile = host.getSourceFile;
  host.fileExists = (file) => file === filename || originalFileExists(file);
  host.readFile = (file) =>
    file === filename ? source : originalReadFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
    file === filename
      ? ts.createSourceFile(file, source, languageVersion, true)
      : originalGetSourceFile(file, languageVersion, onError, shouldCreate);
  return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
};

const childRecord = (relay: object): object => ({
  type: MESSAGE_TYPE,
  ...relay,
});

const generatedRuntimeSource = (): string => runtimeSource();

const createRunner = (): RunnerHarness => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const consoleRecords: ConsoleRecord[] = [];
  const runtimeConsole = {
    debug: (...data: unknown[]) => {
      consoleRecords.push({ method: 'debug', data });
    },
  };
  const runtimeGlobal = {
    console: runtimeConsole,
    addEventListener: (
      type: string,
      listener: (event: MessageEvent) => void
    ) => {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener: (
      type: string,
      listener: (event: MessageEvent) => void
    ) => {
      if (type === 'message') listeners.delete(listener);
    },
  };
  const parent = {};
  const source = ts.transpile(generatedRuntimeSource(), {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  });
  const execute = Function('globalThis', 'document', 'parent', source) as (
    runtimeEnvironment: typeof runtimeGlobal,
    runtimeDocument: Document,
    runtimeParent: object
  ) => void;
  execute(runtimeGlobal, document, parent);
  const dispatchEvent = (source: object, data: unknown): void => {
    for (const listener of [...listeners]) {
      listener({ source, data } as unknown as MessageEvent);
    }
  };

  return {
    parent,
    consoleRecords,
    dispatch: (command, source = parent) => dispatchEvent(source, command),
    emit: (frame, relay) => {
      const source = frame.contentWindow;
      if (!source) throw new Error('Runtime frame has no content window.');
      dispatchEvent(source, childRecord(relay));
    },
    listenerCount: () => listeners.size,
    relays: () =>
      consoleRecords.flatMap((record) => {
        const relay = runtimeRelayRecord(record);
        return relay ? [relay] : [];
      }),
  };
};

const warmupFrame = (): HTMLIFrameElement => {
  const frame = document.querySelector<HTMLIFrameElement>(WARMUP_SELECTOR);
  if (!frame) throw new Error('Runner did not create a warmup iframe.');
  return frame;
};

const executionFrameOrNull = (): HTMLIFrameElement | null =>
  document.querySelector<HTMLIFrameElement>(EXECUTION_SELECTOR);

const executionFrame = (): HTMLIFrameElement => {
  const frame = executionFrameOrNull();
  if (!frame) throw new Error('Runner did not create an execution iframe.');
  return frame;
};

const inlineBootstrap = (): string => {
  const source = frameHtmlSource();
  const script = /<script type="module">([\s\S]*)<\/script>/.exec(source)?.[1];
  if (!script)
    throw new Error('Frame document has no inline module bootstrap.');
  return script.replaceAll('import(', 'load(');
};

const executeBootstrap = (
  search: string,
  loadModule: (
    specifier: string,
    runtime: RuntimeWindow
  ) => Promise<unknown> = () => Promise.resolve(),
  now: () => number = () => performance.now()
): BootstrapHarness => {
  const target = new EventTarget();
  const imports: string[] = [];
  const messages: BootstrapHarness['messages'][number][] = [];
  const runtime = {
    location: { search },
    console: Object.create(console) as Console,
    addEventListener: (type: string, listener: EventListener) =>
      target.addEventListener(type, listener),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
  } as RuntimeWindow;
  const runtimeParent = {
    postMessage: (record: unknown, targetOrigin: string) => {
      messages.push({ record, targetOrigin });
    },
  };
  const execute = Function(
    'parent',
    'globalThis',
    'performance',
    'load',
    inlineBootstrap()
  ) as (
    parent: typeof runtimeParent,
    runtimeGlobal: RuntimeWindow,
    runtimePerformance: { now(): number },
    load: (specifier: string) => Promise<unknown>
  ) => void;
  execute(runtimeParent, runtime, { now }, (specifier) => {
    imports.push(specifier);
    return loadModule(specifier, runtime);
  });
  return { runtime, imports, messages };
};

const flushTasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  document
    .querySelectorAll(`${WARMUP_SELECTOR}, ${EXECUTION_SELECTOR}`)
    .forEach((frame) => frame.remove());
});

it('warms dependencies with encoded static imports only', () => {
  const source = warmupSource(['@favy/di', 'lodash']);
  expect(source).toBe('import "@favy/di";\nimport "lodash";');
  expect(source).not.toContain('/index.ts');
});

it.each([
  ['-foo', true],
  ['@scope/-foo', true],
  ['@-scope/foo', true],
  ['a'.repeat(214), true],
  ['_hidden', false],
  ['pkg?raw', false],
  ['@scope', false],
  ['a'.repeat(215), false],
])('uses one warmup-safe package domain for %s', (name, valid) => {
  expect(isNpmPackageName(name)).toBe(valid);
  if (valid) {
    expect(warmupSource([name])).toBe(`import ${JSON.stringify(name)};`);
  } else {
    expect(() => warmupSource([name])).toThrow(TypeError);
  }
});

it('never resolves a dependency that warmup rejects', () => {
  const result = resolvePlaygroundDependencies(
    "import '@favy/di'; import '@scope/pkg/subpath'; import 'lodash/fp';"
  );
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error('expected ready dependencies');
  expect(() => warmupSource(Object.keys(result.dependencies))).not.toThrow();
});

it.each([
  "@favy/di';globalThis.__ran=true;//",
  './local',
  '/absolute',
  'https://esm.sh/lodash',
  'node:fs',
  '@scope',
  '.hidden',
  '_hidden',
])('rejects unsafe warmup dependency %s', (dependency) => {
  expect(() => warmupSource([dependency])).toThrow();
});

it('generates a privileged runtime with no package import or origin escape hatch', () => {
  const source = generatedRuntimeSource();
  expect(source).not.toMatch(/^\s*import\s/m);
  expect(source).not.toContain('allow-same-origin');
  expect(source).not.toMatch(/\bBlob\b|blob:/);
  expect(source).not.toContain('srcdoc');
  expect(
    diagnosticsForExecution('runtime', source).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
  ).toEqual([]);
});

it('creates opaque URL frames and requires warmup before execution', () => {
  const runner = createRunner();

  runner.dispatch(runtimePrepareCommand(11));
  const warmup = warmupFrame();
  expect(warmup.getAttribute('sandbox')).toBe('allow-scripts');
  expect(warmup.src).toContain('/frame.html?mode=warmup&session=11');

  runner.dispatch(runtimeRunCommand(11, 7));
  expect(executionFrameOrNull()).toBeNull();

  runner.emit(warmup, { kind: 'ready', sessionToken: 11 });
  expect(warmup.isConnected).toBe(false);
  expect(runner.relays()).toEqual([{ kind: 'ready', sessionToken: 11 }]);

  runner.dispatch(runtimeRunCommand(11, 7));
  const execution = executionFrame();
  expect(execution.getAttribute('sandbox')).toBe('allow-scripts');
  expect(execution.src).toContain('/frame.html?mode=run&session=11&run=7');
});

it.each([
  ['wrong source', {}, () => runtimePrepareCommand(11)],
  [
    'wrong type',
    undefined,
    () => ({ type: 'not-favy', action: 'prepare', sessionToken: 11 }),
  ],
  [
    'unknown action',
    undefined,
    () => ({ type: MESSAGE_TYPE, action: 'launch', sessionToken: 11 }),
  ],
  ['negative session', undefined, () => runtimePrepareCommand(-1)],
  ['fractional session', undefined, () => runtimePrepareCommand(1.5)],
  [
    'unsafe session',
    undefined,
    () => runtimePrepareCommand(Number.MAX_SAFE_INTEGER + 1),
  ],
  [
    'missing run token',
    undefined,
    () => ({ type: MESSAGE_TYPE, action: 'run', sessionToken: 11 }),
  ],
  ['negative run token', undefined, () => runtimeRunCommand(11, -1)],
  [
    'unsafe run token',
    undefined,
    () => runtimeRunCommand(11, Number.MAX_SAFE_INTEGER + 1),
  ],
] as const)('rejects a %s command', (_label, source, command) => {
  const runner = createRunner();
  runner.dispatch(command(), source ?? runner.parent);
  expect(
    document.querySelector(`${WARMUP_SELECTOR}, ${EXECUTION_SELECTOR}`)
  ).toBeNull();
  expect(runner.relays()).toEqual([]);
});

it('ignores a hostile command shape whose own-key reflection throws', () => {
  const runner = createRunner();
  const command = new Proxy(
    {
      type: MESSAGE_TYPE,
      action: 'prepare',
      sessionToken: 11,
    },
    {
      ownKeys: () => {
        throw new Error('blocked ownKeys');
      },
    }
  );

  expect(() => runner.dispatch(command)).not.toThrow();
  expect(document.querySelector(WARMUP_SELECTOR)).toBeNull();
  expect(runner.relays()).toEqual([]);
});

it('replaces warmup state and drops messages from the stale frame', () => {
  const runner = createRunner();
  runner.dispatch(runtimePrepareCommand(11));
  const stale = warmupFrame();
  expect(runner.listenerCount()).toBe(2);

  runner.dispatch(runtimePrepareCommand(12));
  const active = warmupFrame();
  expect(stale.isConnected).toBe(false);
  expect(active).not.toBe(stale);
  expect(runner.listenerCount()).toBe(2);

  runner.emit(stale, { kind: 'ready', sessionToken: 11 });
  runner.dispatch(runtimeRunCommand(11, 7));
  expect(executionFrameOrNull()).toBeNull();
  expect(runner.relays()).toEqual([]);

  runner.emit(active, { kind: 'ready', sessionToken: 12 });
  expect(active.isConnected).toBe(false);
  expect(runner.listenerCount()).toBe(1);
  expect(runner.relays()).toEqual([{ kind: 'ready', sessionToken: 12 }]);
});

it('cleans up a failed warmup without preparing its session', () => {
  const runner = createRunner();
  runner.dispatch(runtimePrepareCommand(11));
  const warmup = warmupFrame();

  runner.emit(warmup, {
    kind: 'prepareError',
    sessionToken: 11,
    error: 'warmup failed',
  });

  expect(warmup.isConnected).toBe(false);
  expect(runner.listenerCount()).toBe(1);
  expect(runner.relays()).toEqual([
    { kind: 'prepareError', sessionToken: 11, error: 'warmup failed' },
  ]);
  runner.dispatch(runtimeRunCommand(11, 7));
  expect(executionFrameOrNull()).toBeNull();
});

it('accepts only bounded output from the active source and token domain', () => {
  const runner = createRunner();
  runner.dispatch(runtimePrepareCommand(11));
  const warmup = warmupFrame();
  runner.emit(warmup, { kind: 'ready', sessionToken: 11 });
  runner.dispatch(runtimeRunCommand(11, 7));
  const execution = executionFrame();
  const valid = {
    kind: 'output',
    sessionToken: 11,
    runToken: 7,
    eventId: 0,
    method: 'log',
    data: ['visible', 42, true, null, undefined],
  };

  runner.emit(execution, { ...valid, sessionToken: 12 });
  runner.emit(execution, { ...valid, runToken: 8 });
  runner.emit(execution, { ...valid, eventId: -1 });
  runner.emit(execution, { ...valid, eventId: 0.5 });
  runner.emit(execution, { ...valid, eventId: Number.MAX_SAFE_INTEGER + 1 });
  runner.emit(execution, { ...valid, method: 'trace' });
  runner.emit(execution, { ...valid, data: { not: 'an array' } });
  runner.emit(execution, { ...valid, data: Array(21).fill('wide') });
  runner.emit(execution, { ...valid, data: [{ privileged: true }] });
  runner.emit(execution, { ...valid, data: ['🙂'.repeat(1_025)] });
  runner.dispatch(childRecord(valid), {});
  expect(runner.relays()).toEqual([{ kind: 'ready', sessionToken: 11 }]);

  runner.emit(execution, valid);
  expect(runner.relays()).toEqual([{ kind: 'ready', sessionToken: 11 }, valid]);
});

it('keeps execution alive after an error and cleans it after completion', () => {
  const runner = createRunner();
  runner.dispatch(runtimePrepareCommand(11));
  runner.emit(warmupFrame(), { kind: 'ready', sessionToken: 11 });
  runner.dispatch(runtimeRunCommand(11, 7));
  const execution = executionFrame();

  runner.emit(execution, {
    kind: 'error',
    sessionToken: 11,
    runToken: 7,
    eventId: 0,
    error: 'boom',
  });
  expect(execution.isConnected).toBe(true);
  expect(runner.listenerCount()).toBe(2);

  runner.emit(execution, {
    kind: 'complete',
    sessionToken: 11,
    runToken: 7,
  });
  expect(execution.isConnected).toBe(false);
  expect(runner.listenerCount()).toBe(1);
  expect(runner.relays()).toEqual([
    { kind: 'ready', sessionToken: 11 },
    {
      kind: 'error',
      sessionToken: 11,
      runToken: 7,
      eventId: 0,
      error: 'boom',
    },
    { kind: 'complete', sessionToken: 11, runToken: 7 },
  ]);

  runner.emit(execution, {
    kind: 'output',
    sessionToken: 11,
    runToken: 7,
    eventId: 1,
    method: 'log',
    data: ['stale'],
  });
  expect(runner.relays()).toHaveLength(3);
});

it('cancels only the matching execution and acknowledges once', () => {
  const runner = createRunner();
  runner.dispatch(runtimePrepareCommand(11));
  runner.emit(warmupFrame(), { kind: 'ready', sessionToken: 11 });
  runner.dispatch(runtimeRunCommand(11, 7));
  const execution = executionFrame();

  runner.dispatch(runtimeCancelCommand(11, 8));
  runner.dispatch(runtimeCancelCommand(12, 7));
  expect(execution.isConnected).toBe(true);

  runner.dispatch(runtimeCancelCommand(11, 7));
  expect(execution.isConnected).toBe(false);
  expect(runner.listenerCount()).toBe(1);
  expect(runner.relays()).toEqual([
    { kind: 'ready', sessionToken: 11 },
    { kind: 'cancelled', sessionToken: 11, runToken: 7 },
  ]);

  runner.dispatch(runtimeCancelCommand(11, 7));
  expect(runner.relays()).toHaveLength(2);
});

it('uses exact two-token command records', () => {
  expect(runtimePrepareCommand(11)).toEqual({
    type: MESSAGE_TYPE,
    action: 'prepare',
    sessionToken: 11,
  } satisfies RuntimeCommand);
  expect(runtimeRunCommand(11, 7)).toEqual({
    type: MESSAGE_TYPE,
    action: 'run',
    sessionToken: 11,
    runToken: 7,
  } satisfies RuntimeCommand);
  expect(runtimeCancelCommand(11, 7)).toEqual({
    type: MESSAGE_TYPE,
    action: 'cancel',
    sessionToken: 11,
    runToken: 7,
  } satisfies RuntimeCommand);
});

it.each([
  '?mode=warmup&session=-1',
  '?mode=warmup&session=1.5',
  '?mode=warmup&session=9007199254740992',
  '?mode=warmup&session=11&run=7',
  '?mode=run&session=11',
  '?mode=run&session=11&run=-1',
  '?mode=run&session=11&run=7&run=8',
  '?mode=unknown&session=11',
  '?mode=warmup&mode=run&session=11',
  '?mode=warmup&session=11&extra=true',
] as const)('does not import or post for invalid frame query %s', (search) => {
  const child = executeBootstrap(search);
  expect(child.imports).toEqual([]);
  expect(child.messages).toEqual([]);
});

it('warms in the opaque child without relaying dependency console output', async () => {
  const child = executeBootstrap(
    '?mode=warmup&session=11',
    (_specifier, runtime) => {
      runtime.console.log('dependency side effect');
      return Promise.resolve();
    }
  );

  expect(child.imports).toEqual(['/warmup.ts']);
  await flushTasks();
  expect(child.messages).toEqual([
    {
      record: { type: MESSAGE_TYPE, kind: 'ready', sessionToken: 11 },
      targetOrigin: '*',
    },
  ]);
});

it('normalizes a rejected warmup import into one preparation error', async () => {
  const child = executeBootstrap('?mode=warmup&session=11', () =>
    Promise.reject(new Error('dependency boom'))
  );

  await flushTasks();
  expect(child.messages).toEqual([
    {
      record: {
        type: MESSAGE_TYPE,
        kind: 'prepareError',
        sessionToken: 11,
        error: expect.stringContaining('Error: dependency boom'),
      },
      targetOrigin: '*',
    },
  ]);
});

it('assigns increasing event IDs to execution output and no ID to completion', async () => {
  const child = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.log('first');
      runtime.console.clear();
      runtime.console.warn('third');
      return Promise.resolve();
    }
  );

  expect(child.imports).toEqual(['/execution.ts?session=11&run=7']);
  await flushTasks();
  expect(child.messages.map(({ record }) => record)).toEqual([
    {
      type: MESSAGE_TYPE,
      kind: 'output',
      sessionToken: 11,
      runToken: 7,
      eventId: 0,
      method: 'log',
      data: ['first'],
    },
    {
      type: MESSAGE_TYPE,
      kind: 'output',
      sessionToken: 11,
      runToken: 7,
      eventId: 1,
      method: 'clear',
      data: [],
    },
    {
      type: MESSAGE_TYPE,
      kind: 'output',
      sessionToken: 11,
      runToken: 7,
      eventId: 2,
      method: 'warn',
      data: ['third'],
    },
    {
      type: MESSAGE_TYPE,
      kind: 'complete',
      sessionToken: 11,
      runToken: 7,
    },
  ]);
});

it('restarts event IDs for each fresh execution document', async () => {
  const first = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.log('first run');
      return Promise.resolve();
    }
  );
  const second = executeBootstrap(
    '?mode=run&session=11&run=8',
    (_specifier, runtime) => {
      runtime.console.log('second run');
      return Promise.resolve();
    }
  );
  await flushTasks();

  expect(first.messages[0]?.record).toMatchObject({ runToken: 7, eventId: 0 });
  expect(second.messages[0]?.record).toMatchObject({ runToken: 8, eventId: 0 });
});

it('normalizes cross-realm console values before posting them', async () => {
  const child = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.log(
        new Error('console boom'),
        new Date('2026-08-04T12:34:56.000Z'),
        /favy\s+di/gi,
        { nested: { value: 1 } },
        [1, { nested: true }],
        'text',
        42,
        true,
        null,
        undefined
      );
      return Promise.resolve();
    }
  );
  await flushTasks();

  expect(child.messages[0]?.record).toEqual({
    type: MESSAGE_TYPE,
    kind: 'output',
    sessionToken: 11,
    runToken: 7,
    eventId: 0,
    method: 'log',
    data: [
      expect.stringContaining('Error: console boom'),
      '2026-08-04T12:34:56.000Z',
      '/favy\\s+di/gi',
      '[Object]',
      '[1,"[Object]"]',
      'text',
      42,
      true,
      null,
      undefined,
    ] satisfies PlaygroundConsoleValue[],
  });
});

it('handles cycles and reflection failures without invoking object getters', async () => {
  let getterRuns = 0;
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, 'danger', {
    get: () => {
      getterRuns += 1;
      return 'unsafe';
    },
  });
  const circular: unknown[] = [1];
  circular.push(circular);
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  const child = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.log(value, circular, proxy);
      return Promise.resolve();
    }
  );
  await flushTasks();

  expect(getterRuns).toBe(0);
  expect(child.messages[0]?.record).toMatchObject({
    data: ['[Object]', '[1,"[Circular]"]', '[Unserializable value]'],
  });
});

it('bounds arrays without materializing their own keys before posting', async () => {
  let ownKeyReads = 0;
  const wide = new Proxy(
    Array.from(
      { length: 2_000 },
      (_, index) => `item${index}:${'🙂'.repeat(200)}`
    ),
    {
      ownKeys: (target) => {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      },
    }
  );
  const child = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.log(wide);
      return Promise.resolve();
    }
  );
  await flushTasks();

  const first = child.messages[0]?.record as { data?: unknown[] };
  const serialized = first.data?.[0];
  expect(typeof serialized).toBe('string');
  expect(Buffer.byteLength(serialized as string, 'utf8')).toBeLessThanOrEqual(
    4_096
  );
  expect(serialized).toEqual(expect.stringContaining('[Truncated]'));
  expect(ownKeyReads).toBe(0);
});

it('keeps exactly 20 console arguments and truncates the twenty-first', async () => {
  const child = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.info(...Array.from({ length: 20 }, (_, index) => index));
      runtime.console.warn(...Array.from({ length: 21 }, (_, index) => index));
      return Promise.resolve();
    }
  );
  await flushTasks();

  expect(child.messages[0]?.record).toMatchObject({
    method: 'info',
    data: [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ],
  });
  expect(child.messages[1]?.record).toMatchObject({
    method: 'warn',
    data: [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      '[Truncated]',
    ],
  });
});

it('preserves assert, count, and timer console semantics', async () => {
  const times = [10, 25];
  const child = executeBootstrap(
    '?mode=run&session=11&run=7',
    (_specifier, runtime) => {
      runtime.console.assert(true, 'hidden assertion');
      runtime.console.assert(false, 'visible assertion');
      runtime.console.count('jobs');
      runtime.console.count('jobs');
      runtime.console.time('work');
      runtime.console.timeEnd('work');
      return Promise.resolve();
    },
    () => times.shift() ?? 25
  );
  await flushTasks();

  expect(child.messages.slice(0, -1).map(({ record }) => record)).toEqual([
    expect.objectContaining({
      eventId: 0,
      method: 'assert',
      data: ['Assertion failed:', 'visible assertion'],
    }),
    expect.objectContaining({ eventId: 1, method: 'count', data: ['jobs: 1'] }),
    expect.objectContaining({ eventId: 2, method: 'count', data: ['jobs: 2'] }),
    expect.objectContaining({
      eventId: 3,
      method: 'timeEnd',
      data: ['work: 15ms'],
    }),
  ]);
});

it('de-duplicates an execution failure and completes after import rejection', async () => {
  const failure = new Error('one boom');
  let rejectImport: (error: Error) => void = () => undefined;
  const imported = new Promise<never>((_resolve, reject) => {
    rejectImport = reject;
  });
  const child = executeBootstrap('?mode=run&session=11&run=7', () => imported);
  const event = new Event('error', { cancelable: true });
  Object.defineProperty(event, 'error', { value: failure });

  child.runtime.dispatchEvent(event);
  rejectImport(failure);
  await imported.catch(() => undefined);
  await flushTasks();

  expect(event.defaultPrevented).toBe(true);
  expect(
    child.messages.filter(
      ({ record }) => (record as { kind?: string }).kind === 'error'
    )
  ).toHaveLength(1);
  expect(child.messages.map(({ record }) => record)).toEqual([
    expect.objectContaining({ kind: 'error', eventId: 0 }),
    {
      type: MESSAGE_TYPE,
      kind: 'complete',
      sessionToken: 11,
      runToken: 7,
    },
  ]);
});

it('parses only the private Sandpack relay record', () => {
  const runner = createRunner();
  runner.dispatch(runtimePrepareCommand(11));
  runner.emit(warmupFrame(), { kind: 'ready', sessionToken: 11 });
  const record = runner.consoleRecords[0];
  const marker = record?.data?.[0];

  expect(runtimeRelayRecord(record ?? {})).toEqual({
    kind: 'ready',
    sessionToken: 11,
  });
  expect(
    runtimeRelayRecord({ method: 'log', data: [marker, record?.data?.[1]] })
  ).toBeUndefined();
  expect(
    runtimeRelayRecord({ method: 'debug', data: [marker] })
  ).toBeUndefined();
  expect(
    runtimeRelayRecord({
      method: 'debug',
      data: [marker, { kind: 'ready', sessionToken: -1 }],
    })
  ).toBeUndefined();
  expect(
    runtimeRelayRecord({
      method: 'debug',
      data: [
        marker,
        {
          kind: 'output',
          sessionToken: 11,
          runToken: 7,
          eventId: 0,
          method: 'trace',
          data: [],
        },
      ],
    })
  ).toBeUndefined();
});

it('changes only the execution file and records both token domains', () => {
  const next = setupForRun(setup, 'console.log("new")', 11, 7);
  const changedFiles = Object.keys(next.files).filter(
    (file) => next.files[file].code !== setup.files[file].code
  );

  expect(changedFiles).toEqual(['/execution.ts']);
  expect(next.files['/index.ts']).toEqual(setup.files['/index.ts']);
  expect(next.files['/runner.ts']).toEqual(setup.files['/runner.ts']);
  expect(next.files['/execution.ts'].code).toBe(
    'console.log("new")\n// session:11\n// run:7\n'
  );
  expect(setup.files['/execution.ts'].code).toBe('export {};');
});

it('keeps all generated execution files strict-valid and uninstrumented', () => {
  for (const example of playgroundExamples) {
    const source = setupForRun(setup, example.source, 11, 7).files[
      '/execution.ts'
    ].code;
    expect(
      diagnosticsForExecution(example.id, source).map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      )
    ).toEqual([]);
    expect(source).toBe(`${example.source}\n// session:11\n// run:7\n`);
  }
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
])('maps preparation progress', (message, label) => {
  expect(preparationLabel(message as SandpackMessage)).toBe(label);
});
