/* eslint-disable @typescript-eslint/ban-types -- type-level regression cases intentionally exercise forbidden wrapper contracts */
import { Module, type ModuleLive } from '../src/index';
import type { Live } from '../src';

test('---', () => {
  const A = Module()('A', () => 1);
  expect(A()).toBe(1);
});

test('---', () => {
  const A = Module<{ b: 1 }>()('A', ({ b }) => b + 1);
  expect(A({ b: 1 })).toBe(2);
});

test('---', () => {
  const A = Module()('A', ({ Module }) => Module.name);
  expect(A()).toBe('A');
});

test('---', () => {
  const A = Module<{ p: string } & ModuleLive>()(
    'A',
    ({ Module, p }) => p + Module.name.toString()
  );
  expect(A({ p: '+' })).toBe('+A');
});

test('---', () => {
  const A = Module()('A', () => Math.random());
  expect(A() !== A()).toBe(true);
});

test('---', () => {
  const A = Module()('A', () => 42);
  type ALive = Live<typeof A>;
  const B = Module()('B', () => 28);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ A, B })).toBe(70);
});

test('---', () => {
  const F = Module()('F', () => 15);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F + 42);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => 28 + F);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ F, B, A })).toBe(100);
});

test('---', () => {
  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F * 3);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => F * 4);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ F, B, A })).toBe(7);
});

test('---', () => {
  const F = Module()('F', () => Date.now());
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => F);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A === $.B);
  expect(C({ F, B, A })).toBe(true);
});

test('---', () => {
  const F = Module()('F', () => 'F');
  type FLive = Live<typeof F>;

  const A = Module()('A', () => 'A');
  type ALive = Live<typeof A>;

  const B = Module()('B', () => 'B');
  type BLive = Live<typeof B>;
  const C = Module<ALive & BLive & FLive>()('C', ($) => $.A + $.B + $.F);

  expect(C.provide({ F })({ B, A })).toBe('ABF');
  expect(C.provide({ F, A })({ B })).toBe('ABF');
  expect(C.provide({ F, A, B })()).toBe('ABF');
});

test('---', () => {
  const F = Module()('F', () => 'F');
  type FLive = Live<typeof F>;

  const A = Module()('A', () => 'A');
  type ALive = Live<typeof A>;

  const B = Module()('B', () => 'B');
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive & FLive>()('C', ($) => $.A + $.B + $.F);

  expect(C.provide({ F: 'F', A })({ B: 'B' })).toBe('ABF');
});

test('module exposes its declared name', () => {
  const Named = Module()('Named', () => 1);

  expect(Named.name).toBe('Named');
});

test('symbol-named modules can be resolved as dependencies', () => {
  const DependencyKey = Symbol('Dependency');
  const Dependency = Module()(DependencyKey, () => 42);
  type DependencyLive = Live<typeof Dependency>;

  const Consumer = Module<DependencyLive>()(
    'Consumer',
    (deps) => deps[DependencyKey]
  );

  expect(Dependency.name).toBe(DependencyKey);
  expect(Consumer({ [DependencyKey]: Dependency })).toBe(42);
});

test('nested resolution preserves the current module name', () => {
  const Dependency = Module()('Dependency', () => 1);
  type DependencyLive = Live<typeof Dependency>;

  const Root = Module<DependencyLive & ModuleLive>()(
    'Root',
    ($) => `${$.Dependency}:${$.Module.name.toString()}`
  );

  expect(Root({ Dependency })).toBe('1:Root');
});

test('provide can be chained', () => {
  const Sum = Module<{ a: number; b: number; c: number }>()(
    'Sum',
    ({ a, b, c }) => a + b + c
  );

  const WithAB = Sum.provide({ a: 1 }).provide({ b: 2 });

  expect(WithAB.name).toBe('Sum');
  expect(WithAB({ c: 3 })).toBe(6);

  const widerRoot = { a: 100, b: 2, c: 3 };
  expect(Sum.provide({ a: 1 })(widerRoot)).toBe(6);
});

test('provided modules can be resolved as dependencies', () => {
  const Prefix = Module<{ prefix: string }>()('Prefix', ({ prefix }) => prefix);
  const Consumer = Module<{ Prefix: string }>()('Consumer', ({ Prefix }) =>
    Prefix.toUpperCase()
  );

  expect(Consumer({ Prefix: Prefix.provide({ prefix: 'ok' }) })).toBe('OK');
});

test('provided variants isolate partials and share the parent run cache', () => {
  let sharedRuns = 0;
  const Shared = Module()('Shared', () => ++sharedRuns);
  type SharedLive = Live<typeof Shared>;

  type VariantDeps = SharedLive & { prefix: string; suffix: string };
  const VariantBase = Module<VariantDeps>()(
    'Variant',
    ({ Shared, prefix, suffix }) => `${prefix}-${suffix}:${Shared}`
  );

  const Left = VariantBase.provide({ prefix: 'L' }).provide({
    suffix: 'left',
  });
  const Right = VariantBase.provide({ prefix: 'R' }).provide({
    suffix: 'right',
  });

  const Pair = Module<SharedLive & { Left: string; Right: string }>()(
    'Pair',
    ({ Left, Right }) => [Left, Right]
  );

  expect(Pair({ Shared, Left, Right })).toEqual(['L-left:1', 'R-right:1']);
  expect(sharedRuns).toBe(1);
});

test('dependency keys and null values cannot corrupt the resolution context', () => {
  const Values = Module<{
    first: null;
    hasOwnProperty: string;
    last: number;
  }>()('Values', ({ first, hasOwnProperty, last }) => ({
    first,
    hasOwnProperty,
    last,
  }));

  expect(Values({ first: null, hasOwnProperty: 'safe', last: 2 })).toEqual({
    first: null,
    hasOwnProperty: 'safe',
    last: 2,
  });

  const ReadMissingConstructor = Module<{ constructor?: unknown }>()(
    'ReadMissingConstructor',
    (deps) => deps.constructor
  );
  expect(ReadMissingConstructor({})).toBeUndefined();
});

test('__proto__ is supported as a dependency key', () => {
  const Proto = Module<{ ['__proto__']: string }>()(
    'Proto',
    (deps) => deps['__proto__']
  );

  expect(Proto({ ['__proto__']: 'direct' })).toBe('direct');
  expect(Proto.provide({ ['__proto__']: 'provided' })()).toBe('provided');
});

test('function-valued dependencies remain values, not implicit providers', () => {
  const Invoke = Module<{ handler: () => number }>()('Invoke', ({ handler }) =>
    handler()
  );

  expect(Invoke({ handler: () => 5 })).toBe(5);

  const HandlerProvider = Module()('HandlerProvider', () => () => 6);
  expect(Invoke({ handler: HandlerProvider })).toBe(6);

  const ReturnsNumber = Module()('ReturnsNumber', () => 7);
  const ReadNamedObject = Module<{ value: { name: PropertyKey } }>()(
    'ReadNamedObject',
    ({ value }) => value.name.toString()
  );
  const verifyBrandedFunctionRejected = () => {
    // @ts-expect-error A branded callable is always treated as a provider.
    Invoke({ handler: ReturnsNumber });
    // @ts-expect-error Branded callables cannot masquerade as final objects.
    ReadNamedObject({ value: ReturnsNumber });
  };
  void verifyBrandedFunctionRejected;

  const NamedObjectProvider = Module()('NamedObjectProvider', () => ({
    name: 'provided',
  }));
  expect(ReadNamedObject({ value: NamedObjectProvider })).toBe('provided');
});

test('dependency types reject unmarked providers and unknown partial keys', () => {
  const Double = Module<{ value: number }>()(
    'Double',
    ({ value }) => value * 2
  );

  const verifyRejectedTypes = () => {
    // @ts-expect-error Plain functions are not DI providers.
    Double({ value: () => 5 });
    // @ts-expect-error Partial dependencies cannot contain unknown keys.
    Double.provide({ value: 5, extra: true });
    // @ts-expect-error A module's declared name is readonly.
    Double.name = 'Other';
  };
  void verifyRejectedTypes;

  expect(Double({ value: 5 })).toBe(10);
});

test('provider output types remain covariant without the void exception', () => {
  const ReturnsNumber = Module()('ReturnsNumber', () => 42);
  const NeedsVoid = Module<{ dependency: void }>()(
    'NeedsVoid',
    ({ dependency }) => dependency
  );
  const NeedsNumber = Module<{ dependency: number }>()(
    'NeedsNumber',
    ({ dependency }) => dependency
  );
  const ReturnsLiteral = Module()('ReturnsLiteral', () => 7 as const);

  const verifyProviderResults = () => {
    // @ts-expect-error A number-producing module cannot provide void.
    NeedsVoid({ dependency: ReturnsNumber });
  };
  void verifyProviderResults;

  expect(NeedsNumber({ dependency: ReturnsLiteral })).toBe(7);
});

test('provider requirements must be declared by the consumer', () => {
  const NeedsX = Module<{ x: number }>()('NeedsX', ({ x }) => x.toFixed());
  const IncompleteConsumer = Module<{ value: string }>()(
    'IncompleteConsumer',
    ({ value }) => value
  );

  const verifyTransitiveRequirements = () => {
    // @ts-expect-error NeedsX requires x, which the consumer did not declare.
    IncompleteConsumer({ value: NeedsX });
    // @ts-expect-error Binding a provider cannot erase its undeclared requirements.
    IncompleteConsumer.provide({ value: NeedsX });
  };
  void verifyTransitiveRequirements;

  const Consumer = Module<{ value: string; x: number }>()(
    'Consumer',
    ({ value }) => value
  );
  expect(Consumer({ value: NeedsX, x: 2 })).toBe('2');
  expect(Consumer.provide({ value: NeedsX })({ x: 3 })).toBe('3');

  const WithX = Consumer.provide({ x: 4 });
  expect(WithX.provide({ value: NeedsX })()).toBe('4');
});

test('unknown dependency values accept raw functions and complete providers', () => {
  const NeedsX = Module<{ x: number }>()('NeedsX', ({ x }) => x.toFixed());
  const UnknownConsumer = Module<{ value: unknown }>()(
    'UnknownConsumer',
    ({ value }) => value
  );

  expect(UnknownConsumer({ value: () => 1 })).toEqual(expect.any(Function));

  const CompleteConsumer = Module<{ value: unknown; x: number }>()(
    'CompleteConsumer',
    ({ value }) => value
  );
  expect(CompleteConsumer({ value: NeedsX, x: 2 })).toBe('2');
});

test('generated Module metadata supports narrow and optional contracts', () => {
  const NarrowName = Module<{ Module: { name: 'NarrowName' } }>()(
    'NarrowName',
    ({ Module }) => Module.name
  );
  expect(NarrowName()).toBe('NarrowName');

  const OptionalMetadata = Module<{
    Module?: { name: 'OptionalMetadata' };
  }>()('OptionalMetadata', ({ Module }) => Module?.name);
  expect(OptionalMetadata()).toBe('OptionalMetadata');
});

test('dependency maps consume own fields from object instances', () => {
  class ClassDeps {
    value = 4;

    read() {
      return this.value;
    }
  }

  const ReadClass = Module<ClassDeps>()('ReadClass', ({ value }) => value);
  expect(ReadClass(new ClassDeps())).toBe(4);
  expect(ReadClass.provide(new ClassDeps())()).toBe(4);

  const instance = new ClassDeps();
  const ReadInstanceValue = Module<{ instance: ClassDeps }>()(
    'ReadInstanceValue',
    ({ instance }) => instance.read()
  );
  expect(ReadInstanceValue({ instance })).toBe(4);
});

test('dependency contexts support object rest and spread', () => {
  const A = Module()('A', () => 4);
  type ALive = Live<typeof A>;

  const CopyRoot = Module<ALive>()('CopyRoot', ({ ...all }) => all.A.toFixed());
  expect(CopyRoot({ A })).toBe('4');

  const CopyNested = Module<ALive>()('CopyNested', ({ ...all }) =>
    all.A.toFixed()
  );
  type CopyNestedLive = Live<typeof CopyNested>;
  const Root = Module<ALive & CopyNestedLive>()(
    'Root',
    ({ CopyNested }) => CopyNested
  );

  expect(Root({ A, CopyNested })).toBe('4');
});

test('provider-backed dependency fields can be reassigned', () => {
  const A = Module()('A', () => 1);
  type ALive = Live<typeof A>;
  const Replace = Module<ALive>()('Replace', (deps) => {
    deps.A = 2;
    return deps.A;
  });

  expect(Replace({ A })).toBe(2);
});

test('circular dependencies fail with a clear error', () => {
  const A = Module<{ B: string }>()('A', ({ B }) => B);
  const B = Module<{ A: string }>()('B', ({ A }) => A);
  const Root = Module<{ A: string; B: string }>()('Root', ({ A }) => A);

  expect(() => Root({ A, B })).toThrow(/Circular dependency.*A/);
});

test('union dependency contracts preserve branch-specific requirements', () => {
  type FormatDeps =
    | { kind: 'number'; value: number }
    | { kind: 'text'; text: string };

  const Format = Module<FormatDeps>()('Format', (deps) =>
    deps.kind === 'number' ? deps.value.toFixed(1) : deps.text.toUpperCase()
  );

  const verifyRejectedBranches = () => {
    // @ts-expect-error The number branch requires value.
    Format({ kind: 'number' });
    // @ts-expect-error The text branch requires text.
    Format({ kind: 'text' });
  };
  void verifyRejectedBranches;

  expect(Format({ kind: 'number', value: 2 })).toBe('2.0');
  expect(Format({ kind: 'text', text: 'ok' })).toBe('OK');

  const NumberFormat = Format.provide({ kind: 'number' });
  const TextFormat = Format.provide({ kind: 'text' });

  const maybeExtra: { kind: 'number' } | { kind: 'number'; extra: true } =
    Math.random() > 0.5 ? { kind: 'number' } : { kind: 'number', extra: true };
  // @ts-expect-error Unknown keys are rejected in every partial union branch.
  Format.provide(maybeExtra);

  // @ts-expect-error The selected number branch still requires value.
  void (() => NumberFormat({ text: 'wrong branch' }));
  expect(NumberFormat({ value: 3 })).toBe('3.0');
  expect(TextFormat({ text: 'ready' })).toBe('READY');
});

test('provide narrows the full context for union branches', () => {
  type Choice =
    | { kind: 'number'; value: string; x: number }
    | { kind: 'text'; value: string; y: boolean };

  const Consumer = Module<Choice>()('Consumer', ({ value }) => value);
  const NeedsX = Module<{ x: number }>()('NeedsX', ({ x }) => x.toFixed());
  const NeedsY = Module<{ y: boolean }>()('NeedsY', ({ y }) => String(y));
  const NeedsEither = Module<{ x: number } | { y: boolean }>()(
    'NeedsEither',
    (deps) => ('x' in deps ? deps.x.toFixed() : String(deps.y))
  );

  expect(Consumer({ kind: 'number', value: NeedsX, x: 1 })).toBe('1');
  expect(Consumer.provide({ kind: 'number', value: NeedsX })({ x: 2 })).toBe(
    '2'
  );
  expect(Consumer({ kind: 'number', value: NeedsEither, x: 3 })).toBe('3');
  expect(Consumer({ kind: 'text', value: NeedsEither, y: true })).toBe('true');

  const verifyWrongBranchProviders = () => {
    // @ts-expect-error A number branch cannot satisfy a provider that requires y.
    Consumer({ kind: 'number', value: NeedsY, x: 1 });
    // @ts-expect-error A number partial cannot bind a provider that requires y.
    Consumer.provide({ kind: 'number', value: NeedsY });
  };
  void verifyWrongBranchProviders;

  const NumberConsumer = Consumer.provide({ kind: 'number' });
  const ReadyNumberConsumer = NumberConsumer.provide({ value: NeedsX });

  expect(ReadyNumberConsumer({ x: 2 })).toBe('2');
});

test('optional-only dependencies can be omitted, passed, or provided', () => {
  const Optional = Module<{ label?: string }>()(
    'Optional',
    ({ label = 'default' }) => label
  );

  expect(Optional()).toBe('default');
  expect(Optional({ label: 'passed' })).toBe('passed');
  expect(Optional.provide()()).toBe('default');
  expect(Optional.provide({ label: 'provided' })()).toBe('provided');
  const maybeLabel: { label?: string } = {};
  expect(Optional.provide(maybeLabel)()).toBe('default');

  const Required = Module<{ value: number }>()(
    'Required',
    ({ value }) => value * 2
  );
  expect(Required({ value: 4 })).toBe(8);
  const verifyRequiredProvide = () => {
    // @ts-expect-error Required dependencies still require a partial map.
    Required.provide();
  };
  void verifyRequiredProvide;
});

test('---', () => {
  const A = Module()('A', () => 'A');
  type ALive = Live<typeof A>;

  const B = Module<ALive>()('B', ({ A }) => A + 'B');
  type BLive = Live<typeof B>;

  const C = Module<BLive>()('C', ($) => $.B + 'C');
  type CLive = Live<typeof C>;

  const D = Module<CLive>()('D', ($) => $.C + 'D');
  type DLive = Live<typeof D>;

  const E = Module<DLive>()('E', ($) => $.D + 'E');
  type ELive = Live<typeof E>;

  const F = Module<ELive>()('F', ($) => $.E + 'F');

  expect(F({ E, D, C, B, A })).toBe('ABCDEF');
});

test('---', () => {
  const LVL4 = Module()('LVL4', () => '4');
  type LVL4Live = Live<typeof LVL4>;

  const LVL3 = Module<LVL4Live>()('LVL3', ($) => $.LVL4 + '3');
  type LVL3Live = Live<typeof LVL3>;

  const LVL2 = Module<LVL3Live>()('LVL2', ($) => $.LVL3 + '2');
  type LVL2Live = Live<typeof LVL2>;

  const LVL1 = Module<LVL2Live>()('LVL1', ($) => $.LVL2 + '1');

  expect(LVL1({ LVL2, LVL3, LVL4 })).toBe('4321');
});

test('deep', () => {
  const A = Module()('A', ($) => ({ a: [$.Module.name.toString()] }));
  type ALive = Live<typeof A>;

  const A1 = Module()('A1', () => ({ a: ['A1'], x: [''] }));
  type A1Live = Live<typeof A1>;

  const A2 = Module()('A2', () => ({ a: ['A2'], x: [''] }));
  type A2Live = Live<typeof A2>;

  // 1
  const B = Module<ALive & A1Live & A2Live>()('B', ({ A }) => ({
    c: [A.a[0] + 'B'],
    x: '1',
  }));
  type BLive = Live<typeof B>;

  // 2
  const C = Module<BLive>()('C', ($) => ({ res: [$.B.c[0] + 'C'], z: 1 }));
  type CLive = Live<typeof C>;

  // 3
  const D = Module<CLive>()('D', ($) => $.C.res[0] + 'D');
  type DLive = Live<typeof D>;

  // 4
  const E = Module<DLive>()('E', ($) => [$.D + 'E']);
  type ELive = Live<typeof E>;

  // 5
  const F = Module<ELive>()('F', ($) => $.E[0] + 'F');
  type FLive = Live<typeof F>;

  // 6
  const G = Module<FLive>()('G', ($) => $.F + 'G');
  type GLive = Live<typeof G>;

  // 7
  const H = Module<GLive>()('H', ($) => $.G + 'H');
  type HLive = Live<typeof H>;

  // 8
  const I = Module<HLive>()('I', ($) => $.H + 'I');

  expect(I({ H, G, F, E, D, C, B, A, A1, A2 })).toBe('ABCDEFGHI');
});
