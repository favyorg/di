import {
  dependencySignature,
  resolvePlaygroundDependencies,
  resolvePlaygroundWarmupImports,
} from '../src/components/playground/playground-dependencies';

describe('resolvePlaygroundDependencies', () => {
  it('keeps exact package subpaths for the Vite warmup graph', () => {
    expect(
      resolvePlaygroundWarmupImports(`
        import { Module } from '@favy/di';
        import fp from 'lodash/fp';
        import map from 'lodash/map';
        import fpAgain from 'lodash/fp';
        export { value } from '@scope/pkg/subpath';
      `)
    ).toEqual(['@favy/di', '@scope/pkg/subpath', 'lodash/fp', 'lodash/map']);
  });

  it('only warms package imports that survive TypeScript erasure', () => {
    expect(
      resolvePlaygroundWarmupImports(`
        import type TypeOnly from 'type-default';
        import { type NamedType } from 'type-named';
        export type { ExportedType } from 'type-export';
        export { type ExportedNamedType } from 'type-export-named';
        type ImportedType = import('type-query').ImportedType;

        import runtimeDefault from 'runtime-default';
        import { type Model, runtimeValue } from 'runtime-mixed';
        export { type ExportedModel, runtimeValue } from 'runtime-export-mixed';
        void import('runtime-dynamic');
      `)
    ).toEqual([
      'runtime-default',
      'runtime-dynamic',
      'runtime-export-mixed',
      'runtime-mixed',
    ]);
  });

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
      kind: 'ready',
      dependencies: {
        '@favy/di': 'local',
        '@scope/pkg': 'latest',
        lodash: 'latest',
        zod: 'latest',
      },
    });
    expect(
      resolution.kind === 'ready' && Object.keys(resolution.dependencies)
    ).toEqual(['@favy/di', '@scope/pkg', 'lodash', 'zod']);
  });

  it.each([
    "import './local';",
    "import '../parent';",
    "import '/absolute';",
    "import 'https://esm.sh/zod';",
    "import 'http://example.test/pkg';",
    "import 'data:text/javascript,export default 1';",
    "import 'node:fs';",
    "import 'blob:https://example.test/id';",
    "import 'file:///tmp/example.js';",
    "import 'ftp://example.test/pkg';",
  ])('ignores non-package specifiers in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({
      kind: 'ready',
      dependencies: {},
    });
  });

  it.each(['import {', "import value from '", "void import('pkg"])(
    'reports incomplete import syntax without inventing dependencies',
    (source) =>
      expect(resolvePlaygroundDependencies(source)).toEqual({
        kind: 'incomplete',
      })
  );

  it.each([
    "import { value as } from 'lodash';",
    "import value, from 'lodash';",
    "import {, value } from 'lodash';",
    "import * value from 'lodash';",
    "import { value as default } from 'lodash';",
    "import default from 'lodash';",
    "import 'lodash' garbage;",
    "import value from 'lodash' trailing;",
    "import value from 'lodash' with { type: };",
    "export * value from 'lodash';",
    "export { value } 'lodash';",
    "export { value as } from 'lodash';",
  ])('rejects malformed complete import syntax in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({
      kind: 'incomplete',
    });
  });

  it.each([
    'export { value as };',
    'export {, value };',
    'export { value } garbage;',
  ])('lets Sandpack report malformed local export syntax in %s', (source) => {
    expect(
      resolvePlaygroundDependencies(`${source} import 'later-package';`)
    ).toEqual({
      kind: 'ready',
      dependencies: { 'later-package': 'latest' },
    });
  });

  it.each([
    "export const from = 'package', broken = ;",
    "export default from + 'package' + ;",
  ])('does not mistake a local export for a re-export in %s', (source) => {
    expect(resolvePlaygroundDependencies(`${source} import 'later';`)).toEqual({
      kind: 'ready',
      dependencies: { later: 'latest' },
    });
  });

  it('accepts TypeScript type imports and valid combined clauses', () => {
    expect(
      resolvePlaygroundDependencies(`
        import { default as value, /* type-only */ type Model } from 'named';
        import type DefaultModel from 'types';
        import type { NamedModel } from 'types-named';
        import defaultValue, * as helpers from 'combined';
        export { Source as Target } from 'exports';
        export * as namespace from 'namespace';
      `)
    ).toEqual({
      kind: 'ready',
      dependencies: {
        combined: 'latest',
        exports: 'latest',
        named: 'latest',
        namespace: 'latest',
        types: 'latest',
        'types-named': 'latest',
      },
    });
  });

  it('accepts escaped bindings in valid declarations', () => {
    expect(
      resolvePlaygroundDependencies(String.raw`
        import \u0066oo from 'escaped-default';
        import { value as \u0066oo } from 'escaped-named';
        export { value as \u0066oo } from 'escaped-export';
      `)
    ).toEqual({
      kind: 'ready',
      dependencies: {
        'escaped-default': 'latest',
        'escaped-export': 'latest',
        'escaped-named': 'latest',
      },
    });
  });

  it.each([
    ['const value = ;', {}],
    ["import value from 'lodash'; const broken = ;", { lodash: 'latest' }],
    ['function demo( {', {}],
  ])(
    'does not treat non-import syntax as dependency syntax in %s',
    (source, dependencies) => {
      expect(resolvePlaygroundDependencies(source)).toEqual({
        kind: 'ready',
        dependencies,
      });
    }
  );

  it('ignores module-like text in strings, comments, templates, and regular expressions', () => {
    expect(
      resolvePlaygroundDependencies(`
        const string = "import('string-package')";
        const template = \`export * from 'template-package'\`;
        // import 'line-comment-package';
        /* export { value } from 'block-comment-package'; */
        if (true) /import('regex-package')/.test(string);
        const object = { import: () => undefined };
        object.import('property-package');
        const broken = ;
      `)
    ).toEqual({ kind: 'ready', dependencies: {} });
  });

  it('finds imports inside template interpolations', () => {
    expect(
      resolvePlaygroundDependencies(
        "const value = `${await import('template-package')}`;"
      )
    ).toEqual({
      kind: 'ready',
      dependencies: { 'template-package': 'latest' },
    });
  });

  it('finds a static dynamic-import template', () => {
    expect(
      resolvePlaygroundDependencies('void import(`template-package`);')
    ).toEqual({
      kind: 'ready',
      dependencies: { 'template-package': 'latest' },
    });
  });

  it('accepts multiline declarations and ignores later syntax failures', () => {
    expect(
      resolvePlaygroundDependencies(`
        import {
          value,
          type Model,
        } from 'multiline-package'

        void import('dynamic-package');
        const broken = ;
      `)
    ).toEqual({
      kind: 'ready',
      dependencies: {
        'dynamic-package': 'latest',
        'multiline-package': 'latest',
      },
    });
  });

  it('accepts a re-export whose from clause starts on the next line', () => {
    expect(
      resolvePlaygroundDependencies(`
        export { value }
        from 'multiline-export';
      `)
    ).toEqual({
      kind: 'ready',
      dependencies: { 'multiline-export': 'latest' },
    });
  });

  it.each([
    "export\n{ value } from 'line-broken-export';",
    "export\n* from 'line-broken-export';",
    "export type\n{ Value } from 'line-broken-export';",
  ])(
    'keeps a line-broken re-export despite later invalid code in %s',
    (source) => {
      expect(
        resolvePlaygroundDependencies(`${source}\nconst broken = ;`)
      ).toEqual({
        kind: 'ready',
        dependencies: { 'line-broken-export': 'latest' },
      });
    }
  );

  it.each([
    "import value from 'package'\nwith { type: };",
    "export * from 'package'\nwith { type: };",
  ])('rejects malformed multiline import attributes in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({
      kind: 'incomplete',
    });
  });

  it('does not confuse methods named import with dynamic imports', () => {
    expect(
      resolvePlaygroundDependencies(`
        interface Api { import(value: string): void }
        class Service { import(value: string): void {} }
        const service = { import(): void {} };
        const broken = ;
      `)
    ).toEqual({ kind: 'ready', dependencies: {} });
  });

  it('finds declarations after a block despite a later syntax error', () => {
    expect(
      resolvePlaygroundDependencies(
        "function ready() {} import 'package'; const broken = ;"
      )
    ).toEqual({
      kind: 'ready',
      dependencies: { package: 'latest' },
    });
  });

  it('creates a stable provider key independent of insertion order', () => {
    expect(dependencySignature({ zod: 'latest', '@favy/di': 'local' })).toBe(
      '@favy/di@local|zod@latest'
    );
  });

  it.each([
    'void import();',
    'void import(variable + );',
    "void import('prefix-' + );",
  ])(
    'lets Sandpack report non-static dynamic-import errors in %s',
    (source) => {
      expect(resolvePlaygroundDependencies(source)).toEqual({
        kind: 'ready',
        dependencies: {},
      });
    }
  );

  it.each(["'parenthesized-package'", '`parenthesized-template`'])(
    'keeps a parenthesized literal dependency when later code is invalid: %s',
    (specifier) => {
      expect(
        resolvePlaygroundDependencies(
          `void import(((${specifier}))); const broken = ;`
        )
      ).toEqual({
        kind: 'ready',
        dependencies: {
          [specifier.includes('template')
            ? 'parenthesized-template'
            : 'parenthesized-package']: 'latest',
        },
      });
    }
  );

  it('returns the first unsupported bare specifier in source order', () => {
    expect(
      resolvePlaygroundDependencies("import '_hidden'; import 'pkg?raw';")
    ).toEqual({ kind: 'unsupported', specifier: '_hidden' });
  });

  it('distinguishes incomplete edits from unsupported bare specifiers', () => {
    expect(resolvePlaygroundDependencies("import value from '")).toEqual({
      kind: 'incomplete',
    });
    expect(resolvePlaygroundDependencies("import '_hidden';")).toEqual({
      kind: 'unsupported',
      specifier: '_hidden',
    });
    expect(
      resolvePlaygroundDependencies("import '_hidden'; import value from '")
    ).toEqual({ kind: 'unsupported', specifier: '_hidden' });
  });
});
