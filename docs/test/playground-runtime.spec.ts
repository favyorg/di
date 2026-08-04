import path from 'node:path';
import type {
  SandboxSetup,
  SandpackMessage,
} from '@codesandbox/sandpack-client';
import ts from 'typescript';
import { playgroundExamples } from '../src/components/playground/playground-examples';
import {
  RUN_COMPLETE_PREFIX,
  RUN_OUTPUT_PREFIX,
  completionToken,
  preparationLabel,
  runOutputRecord,
  runSource,
  runtimeCommand,
  runtimeSource,
  setupForRun,
  warmupSource,
} from '../src/components/playground/playground-runtime';

const RUN_FRAME_SELECTOR = 'iframe[data-favy-playground-execution]';
const workspace = path.resolve(__dirname, '../..');

const setup: SandboxSetup = {
  entry: '/runner.ts',
  template: 'node',
  dependencies: { '@favy/di': '3.0.0' },
  files: {
    '/index.ts': { code: 'console.log("old")', active: true },
    '/execution.ts': { code: 'export {};', hidden: true },
    '/runner.ts': { code: 'export {};', hidden: true },
  },
};

type TestRuntime = Readonly<{
  parent: Record<string, unknown>;
  records: unknown[][];
  runtimeConsole: { debug(...data: unknown[]): void };
}>;

type TestChild = Window & typeof globalThis & Readonly<{ console: Console }>;

type TestRun = Readonly<{
  frame: HTMLIFrameElement;
  executeChild(
    load: (specifier: string, child: TestChild) => Promise<unknown>,
    now?: () => number
  ): TestChild;
}>;

const errorMarker = (token: number): string =>
  `__FAVY_PLAYGROUND_ERROR__:${token}`;

const flushChildTasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createTestRuntime = (): TestRuntime => {
  const records: unknown[][] = [];
  const runtimeConsole = {
    debug: (...data: unknown[]) => records.push(data),
  };
  return {
    parent: { console: runtimeConsole },
    records,
    runtimeConsole,
  };
};

const startTestRun = (runtime: TestRuntime, token: number): TestRun => {
  const executableSource = runSource(token).replaceAll('import(', 'load(');
  const execute = Function(
    'globalThis',
    'document',
    'console',
    'load',
    executableSource
  ) as (
    runtimeGlobal: Record<string, unknown>,
    runtimeDocument: Document,
    runtimeConsole: TestRuntime['runtimeConsole'],
    loadModule: (specifier: string) => Promise<unknown>
  ) => void;
  execute(runtime.parent, document, runtime.runtimeConsole, () =>
    Promise.resolve()
  );

  const frames =
    document.querySelectorAll<HTMLIFrameElement>(RUN_FRAME_SELECTOR);
  const frame = frames.item(frames.length - 1);
  if (!frame) throw new Error('Runner did not create an execution iframe.');

  return {
    frame,
    executeChild: (load, now = () => performance.now()) => {
      const child = frame.contentWindow as TestChild | null;
      if (!child) throw new Error('Execution iframe has no window.');
      const script = /<script type="module">([\s\S]*)<\/script>/.exec(
        frame.srcdoc
      )?.[1];
      if (!script) throw new Error('Execution iframe has no module bootstrap.');
      const executeBootstrap = Function(
        'parent',
        'window',
        'globalThis',
        'performance',
        'load',
        script
      ) as (
        runtimeParent: Record<string, unknown>,
        runtimeWindow: TestChild,
        runtimeGlobal: TestChild,
        runtimePerformance: { now(): number },
        loadModule: (specifier: string) => Promise<unknown>
      ) => void;
      executeBootstrap(runtime.parent, child, child, { now }, (specifier) =>
        load(specifier, child)
      );
      return child;
    },
  };
};

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

afterEach(() => {
  document
    .querySelectorAll(RUN_FRAME_SELECTOR)
    .forEach((frame) => frame.remove());
});

it('warms dependencies with encoded static imports only', () => {
  const source = warmupSource(['@favy/di', 'lodash']);
  expect(source).toBe('import "@favy/di";\nimport "lodash";');
  expect(source).not.toContain('/index.ts');
});

it('warms valid package names whose segments begin with hyphens', () => {
  expect(warmupSource(['-foo', '@scope/-foo', '@-scope/foo'])).toBe(
    'import "-foo";\nimport "@scope/-foo";\nimport "@-scope/foo";'
  );
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

it('generates a tokenized child-realm import with one completion record', () => {
  const source = runSource(7);
  expect(source).toContain("import('/execution.ts?run=7')");
  expect(source.match(/__FAVY_PLAYGROUND_DONE__:/g)).toHaveLength(1);
  expect(source).toContain(RUN_COMPLETE_PREFIX + '7');
  expect(source).toContain('srcdoc');
  expect(
    diagnosticsForExecution('runner', source).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
  ).toEqual([]);
});

it('generates a strict-valid static runtime receiver', () => {
  const source = runtimeSource(['@favy/di']);
  expect(source).toContain('import "@favy/di";');
  expect(source).toContain("globalThis.addEventListener('message'");
  expect(
    diagnosticsForExecution('static-runner', source).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
  ).toEqual([]);
});

it('prepares one token before launching its isolated child realm', () => {
  let receive: ((event: MessageEvent) => void) | undefined;
  const runtime = createTestRuntime();
  const runtimeParent = {};
  const runtimeGlobal = {
    console: runtime.runtimeConsole,
    addEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void
    ) => {
      receive = listener;
    },
  };
  const source = ts.transpile(runtimeSource([]), {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  });
  type RuntimeGlobal = typeof runtimeGlobal;
  const execute = Function(
    'globalThis',
    'document',
    'console',
    'parent',
    source
  ) as (
    runtimeEnvironment: RuntimeGlobal,
    runtimeDocument: Document,
    runtimeConsole: TestRuntime['runtimeConsole'],
    runtimeParent: object
  ) => void;
  execute(runtimeGlobal, document, runtime.runtimeConsole, runtimeParent);
  if (!receive) throw new Error('Static runner did not register a receiver.');
  const dispatch = (action: 'prepare' | 'run', token: number): void =>
    receive?.({
      source: runtimeParent,
      data: runtimeCommand(action, token),
    } as unknown as MessageEvent);

  dispatch('run', 7);
  expect(document.querySelectorAll(RUN_FRAME_SELECTOR)).toHaveLength(0);
  dispatch('prepare', 7);
  dispatch('run', 7);
  const first = document.querySelector<HTMLIFrameElement>(RUN_FRAME_SELECTOR);
  expect(first?.dataset.favyPlaygroundExecution).toBe('7');

  dispatch('prepare', 8);
  expect(first?.isConnected).toBe(false);
  dispatch('run', 7);
  expect(document.querySelectorAll(RUN_FRAME_SELECTOR)).toHaveLength(0);
  dispatch('run', 8);
  expect(
    document.querySelector<HTMLIFrameElement>(RUN_FRAME_SELECTOR)?.dataset
      .favyPlaygroundExecution
  ).toBe('8');
});

it('records completion after a failed execution import settles', async () => {
  const runtime = createTestRuntime();
  const events: string[] = [];
  let rejectExecution: (error: Error) => void = () => undefined;
  const executionImport = new Promise<never>((_resolve, reject) => {
    rejectExecution = reject;
  });
  const run = startTestRun(runtime, 7);
  run.executeChild((specifier) => {
    events.push(`import:${specifier}`);
    return executionImport;
  });

  expect(events).toEqual(['import:/execution.ts?run=7']);
  rejectExecution(new Error('execution failed'));
  await executionImport.catch(() => undefined);
  await Promise.resolve();
  expect(runtime.records).toContainEqual([RUN_COMPLETE_PREFIX + '7']);
});

it('reports a rejected execution import before completing the run', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  const failure = new Error('direct boom');

  run.executeChild(() => Promise.reject(failure));
  await flushChildTasks();

  expect(runtime.records[0]?.[0]).toBe(errorMarker(7));
  expect(runtime.records[0]?.[1]).toEqual(
    expect.stringContaining('Error: direct boom')
  );
  expect(runtime.records.at(-1)).toEqual([RUN_COMPLETE_PREFIX + '7']);
  expect(
    runtime.records.filter((record) => record[0] === errorMarker(7))
  ).toHaveLength(1);
});

it.each([
  ['error', 'error', new Error('window boom')],
  ['unhandled rejection', 'unhandledrejection', new Error('promise boom')],
] as const)(
  'reports an active child %s before completion',
  async (_label, eventType, failure) => {
    const runtime = createTestRuntime();
    const run = startTestRun(runtime, 7);
    const child = run.executeChild(() => Promise.resolve());
    const event = new child.Event(eventType, { cancelable: true });
    Object.defineProperty(event, eventType === 'error' ? 'error' : 'reason', {
      value: failure,
    });

    child.dispatchEvent(event);
    await flushChildTasks();

    expect(event.defaultPrevented).toBe(true);
    expect(runtime.records[0]?.[0]).toBe(errorMarker(7));
    expect(runtime.records[0]?.[1]).toEqual(
      expect.stringContaining(failure.message)
    );
    expect(runtime.records.at(-1)).toEqual([RUN_COMPLETE_PREFIX + '7']);
  }
);

it('reports one error when the same failure reaches window and import paths', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  const failure = new Error('one boom');
  let rejectImport: (error: Error) => void = () => undefined;
  const executionImport = new Promise<never>((_resolve, reject) => {
    rejectImport = reject;
  });
  const child = run.executeChild(() => executionImport);
  const event = new child.Event('error', { cancelable: true });
  Object.defineProperty(event, 'error', { value: failure });

  child.dispatchEvent(event);
  rejectImport(failure);
  await flushChildTasks();

  expect(
    runtime.records.filter((record) => record[0] === errorMarker(7))
  ).toHaveLength(1);
  expect(runtime.records.at(-1)).toEqual([RUN_COMPLETE_PREFIX + '7']);
});

it('drops stale child errors after replacing its execution realm', async () => {
  const runtime = createTestRuntime();
  const stale = startTestRun(runtime, 7);
  const staleChild = stale.executeChild(() => Promise.resolve());
  const active = startTestRun(runtime, 8);
  const activeChild = active.executeChild(() => Promise.resolve());
  const dispatchError = (child: TestChild, message: string): void => {
    const event = new child.Event('error', { cancelable: true });
    Object.defineProperty(event, 'error', { value: new Error(message) });
    child.dispatchEvent(event);
  };

  dispatchError(staleChild, 'stale boom');
  dispatchError(activeChild, 'active boom');
  await flushChildTasks();

  expect(runtime.records.some((record) => record[0] === errorMarker(7))).toBe(
    false
  );
  expect(runtime.records).toContainEqual([
    errorMarker(8),
    expect.stringContaining('active boom'),
  ]);
});

it('tokenizes execution without mutating the previous setup', () => {
  const first = setupForRun(setup, 'console.log("new")', 7);
  const second = setupForRun(first, 'console.log("new")', 8);
  expect(first.files['/execution.ts'].code).toContain('// run:7');
  expect(second.files['/execution.ts'].code).toContain('// run:8');
  expect(first.files['/runner.ts']).toEqual(setup.files['/runner.ts']);
  expect(setup.files['/index.ts'].code).toBe('console.log("old")');
});

it('changes only the execution file for each run', () => {
  const next = setupForRun(setup, 'console.log("new")', 7);
  const changedFiles = Object.keys(next.files).filter(
    (path) => next.files[path].code !== setup.files[path].code
  );

  expect(changedFiles).toEqual(['/execution.ts']);
  expect(next.files['/index.ts']).toEqual(setup.files['/index.ts']);
  expect(next.files['/runner.ts']).toEqual(setup.files['/runner.ts']);
  expect(next.files['/execution.ts'].code).toBe(
    'console.log("new")\n// run:7\n'
  );
});

it('tokens globalThis, window, and imported-module console output', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);

  run.executeChild((_specifier, child) => {
    const executeImportedModule = Function(
      'window',
      'globalThis',
      "globalThis.console.log('global output');" +
        "window.console.log('window output');" +
        "globalThis.console.log('imported output');"
    ) as (runtimeWindow: TestChild, runtimeGlobal: TestChild) => void;
    executeImportedModule(child, child);
    return Promise.resolve();
  });
  await Promise.resolve();

  expect(runtime.records).toEqual(
    expect.arrayContaining([
      [RUN_OUTPUT_PREFIX + '7', 'log', 'global output'],
      [RUN_OUTPUT_PREFIX + '7', 'log', 'window output'],
      [RUN_OUTPUT_PREFIX + '7', 'log', 'imported output'],
    ])
  );
});

it('normalizes cross-realm console values before forwarding them', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);

  run.executeChild((_specifier, child) => {
    child.console.log(
      new child.Error('console boom'),
      new child.Date('2026-08-04T12:34:56.000Z'),
      new child.RegExp('favy\\s+di', 'gi'),
      { nested: { value: 1 } },
      [1, { nested: true }],
      'text',
      42,
      true,
      null
    );
    return Promise.resolve();
  });
  await flushChildTasks();

  expect(runtime.records).toContainEqual([
    RUN_OUTPUT_PREFIX + '7',
    'log',
    expect.stringContaining('Error: console boom'),
    '2026-08-04T12:34:56.000Z',
    '/favy\\s+di/gi',
    '[Object]',
    '[1,"[Object]"]',
    'text',
    42,
    true,
    null,
  ]);
});

it('handles cycles without invoking object getters', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  let getterRuns = 0;
  const value: Record<string, unknown> = { safe: 1 };
  Object.defineProperty(value, 'danger', {
    enumerable: true,
    get: () => {
      getterRuns += 1;
      return 'unsafe';
    },
  });
  value.self = value;
  const circular: unknown[] = [1];
  circular.push(circular);

  run.executeChild((_specifier, child) => {
    child.console.log(value, circular);
    return Promise.resolve();
  });
  await flushChildTasks();

  expect(getterRuns).toBe(0);
  expect(runtime.records).toContainEqual([
    RUN_OUTPUT_PREFIX + '7',
    'log',
    '[Object]',
    '[1,"[Circular]"]',
  ]);
});

it('bounds arrays without materializing their own keys', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  let ownKeyReads = 0;
  let descriptorReads = 0;
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
      getOwnPropertyDescriptor: (target, key) => {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }
  );

  run.executeChild((_specifier, child) => {
    child.console.log(wide);
    return Promise.resolve();
  });
  await flushChildTasks();

  const value = runtime.records.find(
    (record) => record[0] === RUN_OUTPUT_PREFIX + '7'
  )?.[2];
  expect(typeof value).toBe('string');
  expect((value as string).length).toBeLessThanOrEqual(4_096);
  expect(Buffer.byteLength(value as string, 'utf8')).toBeLessThanOrEqual(4_096);
  expect(value).toEqual(expect.stringContaining('item0'));
  expect(value).toEqual(expect.stringContaining('[Truncated]'));
  expect(ownKeyReads).toBe(0);
  expect(descriptorReads).toBeLessThan(256);
  expect(runtime.records.at(-1)).toEqual([RUN_COMPLETE_PREFIX + '7']);
});

it('does not enumerate unknown console objects before completing the run', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  const keys = Array.from({ length: 2_500 }, (_, index) => `hidden${index}`);
  let ownKeyReads = 0;
  let descriptorReads = 0;
  const value = new Proxy(Object.create(null) as Record<string, unknown>, {
    ownKeys: () => {
      ownKeyReads += 1;
      return keys;
    },
    getOwnPropertyDescriptor: (_target, key) => {
      descriptorReads += 1;
      return typeof key === 'string' && key.startsWith('hidden')
        ? { configurable: true, enumerable: false, value: 'hidden' }
        : undefined;
    },
  });

  run.executeChild((_specifier, child) => {
    child.console.log(value);
    return Promise.resolve();
  });
  await flushChildTasks();

  expect(descriptorReads).toBeLessThan(8);
  expect(ownKeyReads).toBe(0);
  expect(runtime.records).toContainEqual([
    RUN_OUTPUT_PREFIX + '7',
    'log',
    '[Object]',
  ]);
  expect(runtime.records.at(-1)).toEqual([RUN_COMPLETE_PREFIX + '7']);
});

it('renders a safe placeholder when proxy reflection throws', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  run.executeChild((_specifier, child) => {
    child.console.log(proxy);
    return Promise.resolve();
  });
  await flushChildTasks();

  expect(runtime.records).toContainEqual([
    RUN_OUTPUT_PREFIX + '7',
    'log',
    '[Unserializable value]',
  ]);
  expect(runtime.records.at(-1)).toEqual([RUN_COMPLETE_PREFIX + '7']);
});

it('drops qualified output from a replaced child realm', async () => {
  const runtime = createTestRuntime();
  const first = startTestRun(runtime, 7);
  first.executeChild(() => Promise.resolve());
  const staleConsole = (first.frame.contentWindow as TestChild | null)?.console;
  if (!staleConsole) throw new Error('First execution iframe has no console.');

  const replacement = startTestRun(runtime, 8);
  replacement.executeChild((_specifier, child) => {
    child.console.log('replacement output');
    return Promise.resolve();
  });
  staleConsole.log('stale qualified output');
  await Promise.resolve();

  expect(runtime.records).toContainEqual([
    RUN_OUTPUT_PREFIX + '8',
    'log',
    'replacement output',
  ]);
  expect(runtime.records).not.toContainEqual([
    RUN_OUTPUT_PREFIX + '7',
    'log',
    'stale qualified output',
  ]);
});

it('preserves assert, clear, count, and timer console semantics', async () => {
  const runtime = createTestRuntime();
  const run = startTestRun(runtime, 7);
  const times = [10, 25];

  run.executeChild(
    (_specifier, child) => {
      child.console.assert(true, 'hidden assertion');
      child.console.assert(false, 'visible assertion');
      child.console.clear();
      child.console.count('jobs');
      child.console.count('jobs');
      child.console.time('work');
      child.console.timeEnd('work');
      return Promise.resolve();
    },
    () => times.shift() ?? 25
  );
  await Promise.resolve();

  const output = runtime.records.filter(
    (record) => record[0] === RUN_OUTPUT_PREFIX + '7'
  );
  expect(output.filter((record) => record[1] === 'assert')).toEqual([
    expect.arrayContaining(['visible assertion']),
  ]);
  expect(output).toContainEqual([RUN_OUTPUT_PREFIX + '7', 'clear']);
  expect(output).toContainEqual([RUN_OUTPUT_PREFIX + '7', 'count', 'jobs: 1']);
  expect(output).toContainEqual([RUN_OUTPUT_PREFIX + '7', 'count', 'jobs: 2']);
  expect(output).toContainEqual([
    RUN_OUTPUT_PREFIX + '7',
    'timeEnd',
    'work: 15ms',
  ]);
});

it('removes the previous execution iframe before creating its replacement', () => {
  const runtime = createTestRuntime();
  const first = startTestRun(runtime, 7);

  const replacement = startTestRun(runtime, 8);

  expect(first.frame.isConnected).toBe(false);
  expect(replacement.frame.isConnected).toBe(true);
  expect(document.querySelectorAll(RUN_FRAME_SELECTOR)).toHaveLength(1);
});

it('keeps all generated execution files strict-valid and uninstrumented', () => {
  for (const example of playgroundExamples) {
    const source = setupForRun(setup, example.source, 7).files['/execution.ts']
      .code;
    const diagnostics = diagnosticsForExecution(example.id, source);
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      )
    ).toEqual([]);
    expect(source).toBe(`${example.source}\n// run:7\n`);
  }
});

it('recognizes only private debug completion records', () => {
  expect(
    completionToken({
      method: 'debug',
      data: [RUN_COMPLETE_PREFIX + '12'],
    })
  ).toBe(12);
  expect(
    completionToken({
      method: 'log',
      data: [RUN_COMPLETE_PREFIX + '12'],
    })
  ).toBeUndefined();
});

it('decodes tokenized run output without changing its values', () => {
  const value = { circular: true };
  expect(
    runOutputRecord({
      method: 'debug',
      data: [RUN_OUTPUT_PREFIX + '12', 'log', 'hello', value],
    })
  ).toEqual({ token: 12, method: 'log', data: ['hello', value] });
  expect(
    runOutputRecord({
      method: 'log',
      data: [RUN_OUTPUT_PREFIX + '12', 'log', 'hello'],
    })
  ).toBeUndefined();
});

it.each([
  [{ method: 'debug', data: [RUN_OUTPUT_PREFIX + '', 'log'] }],
  [{ method: 'debug', data: [RUN_OUTPUT_PREFIX + '12.5', 'log'] }],
  [
    {
      method: 'debug',
      data: [RUN_OUTPUT_PREFIX + '9007199254740992', 'log'],
    },
  ],
  [{ method: 'debug', data: [RUN_OUTPUT_PREFIX + '12', 'unknown'] }],
  [{ method: 'debug', data: [RUN_COMPLETE_PREFIX + '12'] }],
])('rejects malformed run output records', (record) => {
  expect(runOutputRecord(record)).toBeUndefined();
});

it.each([
  [{ method: 'debug', data: [RUN_COMPLETE_PREFIX + ''] }],
  [{ method: 'debug', data: [RUN_COMPLETE_PREFIX + '12', 'extra'] }],
  [{ method: 'debug', data: [RUN_COMPLETE_PREFIX + '12.5'] }],
  [{ method: 'debug', data: [RUN_COMPLETE_PREFIX + '9007199254740992'] }],
  [{ method: 'debug', data: [12] }],
])('rejects malformed completion records', (record) => {
  expect(completionToken(record)).toBeUndefined();
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
