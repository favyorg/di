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

it('warms dependencies without importing editable code', () => {
  const source = warmupSource(['@favy/di', 'lodash']);
  expect(source).toContain("import '@favy/di';");
  expect(source).toContain("import 'lodash';");
  expect(source).not.toContain('/index.ts');
});

it('generates a tokenized execution import with one completion record', () => {
  const source = runSource(7);
  expect(source).toContain("import('/execution.ts?run=7')");
  expect(source.match(/console\.debug/g)).toHaveLength(1);
  expect(source).toContain(RUN_COMPLETE_PREFIX + '7');
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
