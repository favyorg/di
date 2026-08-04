import {
  dependencySignature,
  resolvePlaygroundDependencies,
} from '../src/components/playground/playground-dependencies';

describe('resolvePlaygroundDependencies', () => {
  it('extracts, normalizes, pins, deduplicates, and sorts npm packages', () => {
    const resolution = resolvePlaygroundDependencies(`
      import { Module } from '@favy/di';
      import fp from 'lodash/fp';
      export { value } from '@scope/pkg/subpath';
      void import('zod');
      void import(variable);
      void import('lodash/map');
    `);

    expect(resolution).toEqual({
      ok: true,
      dependencies: {
        '@favy/di': '3.0.0',
        '@scope/pkg': 'latest',
        lodash: 'latest',
        zod: 'latest',
      },
    });
    expect(resolution.ok && Object.keys(resolution.dependencies)).toEqual([
      '@favy/di',
      '@scope/pkg',
      'lodash',
      'zod',
    ]);
  });

  it.each([
    "import './local';",
    "import '../parent';",
    "import '/absolute';",
    "import 'https://esm.sh/zod';",
    "import 'http://example.test/pkg';",
    "import 'data:text/javascript,export default 1';",
    "import 'node:fs';",
  ])('ignores non-package specifiers in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({
      ok: true,
      dependencies: {},
    });
  });

  it.each(["import {", "import value from '", "void import('pkg"])(
    'reports incomplete import syntax without inventing dependencies',
    (source) => expect(resolvePlaygroundDependencies(source)).toEqual({ ok: false }),
  );

  it('creates a stable provider key independent of insertion order', () => {
    expect(dependencySignature({ zod: 'latest', '@favy/di': '3.0.0' })).toBe(
      '@favy/di@3.0.0|zod@latest',
    );
  });
});
