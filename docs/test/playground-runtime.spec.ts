import type {
  SandboxSetup,
  SandpackMessage,
} from '@codesandbox/sandpack-client';
import {
  RUN_COMPLETE_PREFIX,
  completionToken,
  preparationLabel,
  runSource,
  setupForRun,
  warmupSource,
} from '../src/components/playground/playground-runtime';

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

const executeRunSource = (
  source: string,
  load: (specifier: string) => Promise<unknown>,
  debug: (value: unknown) => void
): Promise<unknown> => {
  const executableSource = source.replace('void import(', 'return load(');
  const execute = Function('load', 'console', executableSource) as (
    loadModule: (specifier: string) => Promise<unknown>,
    runtimeConsole: { debug(value: unknown): void }
  ) => Promise<unknown>;
  return execute(load, { debug });
};

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

it('generates a tokenized execution import with one completion record', () => {
  const source = runSource(7);
  expect(source).toContain("import('/execution.ts?run=7')");
  expect(source.match(/console\.debug/g)).toHaveLength(1);
  expect(source).toContain(RUN_COMPLETE_PREFIX + '7');
});

it('records completion after a failed execution import settles', async () => {
  const events: string[] = [];
  let rejectExecution: (error: Error) => void = () => undefined;
  const executionImport = new Promise<never>((_resolve, reject) => {
    rejectExecution = reject;
  });
  const execution = executeRunSource(
    runSource(7),
    (specifier) => {
      events.push(`import:${specifier}`);
      return executionImport;
    },
    (value) => events.push(`debug:${String(value)}`)
  );

  expect(events).toEqual(['import:/execution.ts?run=7']);
  rejectExecution(new Error('execution failed'));
  await expect(execution).rejects.toThrow('execution failed');
  expect(events).toEqual([
    'import:/execution.ts?run=7',
    `debug:${RUN_COMPLETE_PREFIX}7`,
  ]);
});

it('tokenizes execution and does not mutate the previous setup', () => {
  const first = setupForRun(setup, 'console.log("new")', 7);
  const second = setupForRun(first, 'console.log("new")', 8);
  expect(first.files['/execution.ts'].code).toContain('// run:7');
  expect(second.files['/execution.ts'].code).toContain('// run:8');
  expect(first.files['/runner.ts'].code).toContain('/execution.ts?run=7');
  expect(setup.files['/index.ts'].code).toBe('console.log("old")');
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
