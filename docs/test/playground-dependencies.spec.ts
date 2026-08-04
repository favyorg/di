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
    "import 'blob:https://example.test/id';",
    "import 'file:///tmp/example.js';",
    "import 'ftp://example.test/pkg';",
  ])('ignores non-package specifiers in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({
      ok: true,
      dependencies: {},
    });
  });

  it.each(['import {', "import value from '", "void import('pkg"])(
    'reports incomplete import syntax without inventing dependencies',
    (source) =>
      expect(resolvePlaygroundDependencies(source)).toEqual({ ok: false }),
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
    expect(resolvePlaygroundDependencies(source)).toEqual({ ok: false });
  });

  it.each([
    'export { value as };',
    'export {, value };',
    'export { value } garbage;',
  ])('lets Sandpack report malformed local export syntax in %s', (source) => {
    expect(
      resolvePlaygroundDependencies(`${source} import 'later-package';`),
    ).toEqual({
      ok: true,
      dependencies: { 'later-package': 'latest' },
    });
  });

  it.each([
    "export const from = 'package', broken = ;",
    "export default from + 'package' + ;",
  ])('does not mistake a local export for a re-export in %s', (source) => {
    expect(resolvePlaygroundDependencies(`${source} import 'later';`)).toEqual({
      ok: true,
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
      `),
    ).toEqual({
      ok: true,
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
      `),
    ).toEqual({
      ok: true,
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
        ok: true,
        dependencies,
      });
    },
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
      `),
    ).toEqual({ ok: true, dependencies: {} });
  });

  it('finds imports inside template interpolations', () => {
    expect(
      resolvePlaygroundDependencies(
        "const value = `${await import('template-package')}`;",
      ),
    ).toEqual({
      ok: true,
      dependencies: { 'template-package': 'latest' },
    });
  });

  it('finds a static dynamic-import template', () => {
    expect(
      resolvePlaygroundDependencies('void import(`template-package`);'),
    ).toEqual({
      ok: true,
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
      `),
    ).toEqual({
      ok: true,
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
      `),
    ).toEqual({
      ok: true,
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
        resolvePlaygroundDependencies(`${source}\nconst broken = ;`),
      ).toEqual({
        ok: true,
        dependencies: { 'line-broken-export': 'latest' },
      });
    },
  );

  it.each([
    "import value from 'package'\nwith { type: };",
    "export * from 'package'\nwith { type: };",
  ])('rejects malformed multiline import attributes in %s', (source) => {
    expect(resolvePlaygroundDependencies(source)).toEqual({ ok: false });
  });

  it('does not confuse methods named import with dynamic imports', () => {
    expect(
      resolvePlaygroundDependencies(`
        interface Api { import(value: string): void }
        class Service { import(value: string): void {} }
        const service = { import(): void {} };
        const broken = ;
      `),
    ).toEqual({ ok: true, dependencies: {} });
  });

  it('finds declarations after a block despite a later syntax error', () => {
    expect(
      resolvePlaygroundDependencies(
        "function ready() {} import 'package'; const broken = ;",
      ),
    ).toEqual({
      ok: true,
      dependencies: { package: 'latest' },
    });
  });

  it('creates a stable provider key independent of insertion order', () => {
    expect(dependencySignature({ zod: 'latest', '@favy/di': '3.0.0' })).toBe(
      '@favy/di@3.0.0|zod@latest',
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
        ok: true,
        dependencies: {},
      });
    },
  );

  it.each(["'parenthesized-package'", '`parenthesized-template`'])(
    'keeps a parenthesized literal dependency when later code is invalid: %s',
    (specifier) => {
      expect(
        resolvePlaygroundDependencies(
          `void import(((${specifier}))); const broken = ;`,
        ),
      ).toEqual({
        ok: true,
        dependencies: {
          [specifier.includes('template')
            ? 'parenthesized-template'
            : 'parenthesized-package']: 'latest',
        },
      });
    },
  );
});
