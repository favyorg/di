import { Module, makeModule, type Live } from '../src';

test('a run root caches a provider created by a none factory', () => {
  const UncachedModule = makeModule({ cache: 'none' });
  let runs = 0;
  const Counter = UncachedModule()('Counter', () => ++runs);
  const Root = Module<Live<typeof Counter>>()('Root', (deps) => [
    deps.Counter,
    deps.Counter,
  ]);

  expect(Root({ Counter })).toEqual([1, 1]);
  expect(Root({ Counter })).toEqual([2, 2]);
  expect(runs).toBe(2);
});

test('a none root reevaluates a provider created by a run factory', () => {
  const UncachedModule = makeModule({ cache: 'none' });
  let runs = 0;
  const Counter = Module()('Counter', () => ++runs);
  const Root = UncachedModule<Live<typeof Counter>>()('Root', (deps) => [
    deps.Counter,
    deps.Counter,
  ]);

  expect(Root({ Counter })).toEqual([1, 2]);
  expect(Root({ Counter })).toEqual([3, 4]);
  expect(runs).toBe(4);
});

test('a provider owns its module cache even under a none root', () => {
  const UncachedModule = makeModule({ cache: 'none' });
  const CachedModule = makeModule({ cache: 'module' });
  let runs = 0;
  const Counter = CachedModule()('Counter', () => ++runs);
  const Root = UncachedModule<Live<typeof Counter>>()('Root', (deps) => [
    deps.Counter,
    deps.Counter,
  ]);

  expect(Root({ Counter })).toEqual([1, 1]);
  UncachedModule.flushCache();
  expect(Root({ Counter })).toEqual([1, 1]);
  expect(runs).toBe(1);

  CachedModule.flushCache();
  expect(Root({ Counter })).toEqual([2, 2]);
  expect(runs).toBe(2);
});

test.each([
  { label: 'undefined', value: undefined },
  { label: 'null', value: null },
  { label: 'false', value: false },
  { label: 'zero', value: 0 },
  { label: 'empty string', value: '' },
  { label: 'NaN', value: NaN },
])('module cache retains $label until flushed', ({ value }) => {
  const CachedModule = makeModule({ cache: 'module' });
  let runs = 0;
  const Value = CachedModule()('Value', () => {
    runs++;
    return value;
  });

  expect(Value()).toBe(value);
  expect(Value()).toBe(value);
  expect(runs).toBe(1);

  CachedModule.flushCache();
  expect(Value()).toBe(value);
  expect(Value()).toBe(value);
  expect(runs).toBe(2);
});

describe.each(['run', 'module'] as const)(
  'assignment during provider resolution with cache=%s',
  (cache) => {
    test.each(['extensible', 'sealed', 'frozen'] as const)(
      'preserves the explicit value when the context is %s',
      (state) => {
        const Module = makeModule({ cache });
        let runs = 0;
        const Value = Module<{ Value: number }>()('Value', (deps) => {
          runs++;
          deps.Value = 42;
          return 1;
        });
        const Reader = Module<Live<typeof Value>>()('Reader', (deps) => () => {
          if (state === 'sealed') Object.seal(deps);
          if (state === 'frozen') Object.freeze(deps);
          return [deps.Value, deps.Value];
        });
        const Root = Module<Live<typeof Reader>>()('Root', (deps) => ({
          read: deps.Reader,
          sharedValue: () => deps.Value,
        }));

        const { read, sharedValue } = Root({ Reader, Value });
        expect(runs).toBe(0);
        expect(read()).toEqual([1, 42]);
        expect(sharedValue()).toBe(42);
        expect(read()).toEqual([42, 42]);
        expect(runs).toBe(1);
      }
    );
  }
);

test.each([
  { rootCache: 'run', ownerCache: 'none', expected: [1, 2], runs: 2 },
  { rootCache: 'none', ownerCache: 'run', expected: [1, 1], runs: 1 },
] as const)(
  'a $rootCache root preserves its nested $ownerCache provide binding policy',
  ({ rootCache, ownerCache, expected, runs: expectedRuns }) => {
    const RootModule = makeModule({ cache: rootCache });
    const OwnerModule = makeModule({ cache: ownerCache });
    let runs = 0;
    const Counter = Module()('Counter', () => ++runs);
    const Reader = OwnerModule<Live<typeof Counter>>()('Reader', (deps) => [
      deps.Counter,
      deps.Counter,
    ]).provide({ Counter });
    const Root = RootModule<Live<typeof Reader>>()(
      'Root',
      (deps) => deps.Reader
    );

    expect(Root({ Reader })).toEqual(expected);
    expect(runs).toBe(expectedRuns);
  }
);
