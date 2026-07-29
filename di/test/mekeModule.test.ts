/* eslint-disable @typescript-eslint/ban-types -- type-level regression cases intentionally use broad object types */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  makeModule,
  type HKT,
  type ModuleLive,
  type TModule,
  type transformInput,
  withModuleName,
} from '../src';
import type { Live } from '../src';

test('the production core remains compact', () => {
  const sourceRoot = resolve(__dirname, '../src');
  const lines = (file: string) =>
    readFileSync(resolve(sourceRoot, file), 'utf8').split(/\r?\n/).length;

  expect(lines('lib/makeModule.ts')).toBeLessThanOrEqual(240);
  expect(
    ['index.ts', 'lib/hkt.ts', 'lib/makeModule.ts', 'lib/module.ts'].reduce(
      (total, file) => total + lines(file),
      0
    )
  ).toBeLessThanOrEqual(290);
});

test('makeModule transformInput', () => {
  const Module = makeModule({
    transformInput: <D extends object>(deps: D) => deps,
  });
  const A = Module()('A', () => 1);
  expect(A()).toBe(1);
});

test('provider contexts preserve nominal class inheritance', () => {
  const Module = makeModule({
    transformInput: (deps) => {
      interface Identity extends HKT {
        readonly type: this['_DEPS'];
      }

      return deps as unknown as Identity;
    },
  });

  class Base {
    private readonly nominal = 0;
    x = 1;
  }

  class Derived<Value = string> extends Base {
    value!: Value;
  }

  const Provider = Module<Base>()('Provider', ({ x }) => x.toFixed());
  const Consumer = Module<Derived<string>>()(
    'Consumer',
    ({ value }) => value
  );

  const root = new Derived<typeof Provider>();
  root.value = Provider;

  expect(Consumer(root)).toBe('1');

  const StructuralConsumer = Module<{ value: string; x: number }>()(
    'StructuralConsumer',
    ({ value }) => value
  );
  const verifyNominalRequirement = () => {
    // @ts-expect-error A structural lookalike cannot satisfy Base's private brand.
    StructuralConsumer({ value: Provider, x: 1 });
  };
  void verifyNominalRequirement;
});

test('Live preserves keyless nominal and callable dependencies', () => {
  class KeylessNominal {
    private readonly nominal = 0;
  }
  type NominalLive = Live<TModule<'Nominal', KeylessNominal, 1>>;
  type CallableLive = Live<TModule<'Callable', () => void, 2>>;

  const verifyNominal = () => {
    // @ts-expect-error A private brand must survive Live extraction.
    const structural: NominalLive = { Nominal: 1 };
    return structural;
  };
  void verifyNominal;

  const verifyCallable = () => {
    // @ts-expect-error A call signature must survive Live extraction.
    const structural: CallableLive = { Callable: 2 };
    return structural;
  };
  void verifyCallable;

  const callable = Object.assign(() => undefined, {
    Callable: 2 as const,
  }) satisfies CallableLive;
  callable();
  expect(callable.Callable).toBe(2);
});

test('makeModule omitted transforms use typed runtime defaults', () => {
  const DefaultModule = makeModule({});
  const Named = DefaultModule()('Named', ({ Module }) => Module.name);
  const Explicit = DefaultModule<ModuleLive>()(
    'Explicit',
    ({ Module }) => Module.name
  );

  expect(Named()).toBe('Named');
  expect(Explicit()).toBe('Explicit');
});

test('makeModule transformInput withModuleName', () => {
  const Module = makeModule({
    transformInput: withModuleName,
  });

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

test('withModuleName preserves input fields and returns the literal name', () => {
  const deps = { value: 2, Module: { old: true } };
  const named = withModuleName(deps, 'Direct');

  const value: number = named.value;
  const name: 'Direct' = named.Module.name;
  const verifyReplacement = () => {
    // @ts-expect-error withModuleName replaces the complete Module field.
    named.Module.old;
  };
  void verifyReplacement;

  expect(value).toBe(2);
  expect(name).toBe('Direct');
  expect(named).toBe(deps);
});

test('withModuleName preserves discriminated union branches', () => {
  const deps =
    Math.random() > 0.5
      ? { kind: 'a' as const, a: 1 as const, Module: { old: true } }
      : { kind: 'b' as const, b: 2 as const };
  const named = withModuleName(deps, 'Union');

  if (named.kind === 'a') {
    const a: 1 = named.a;
    expect(a).toBe(1);
  } else {
    const b: 2 = named.b;
    expect(b).toBe(2);
  }

  const name: 'Union' = named.Module.name;
  expect(name).toBe('Union');
});

test('custom metadata fields participate in the callback contract', () => {
  const TokenModule = makeModule({
    transformInput: <D extends object>(deps: D, name: PropertyKey) =>
      Object.assign(deps, {
        Module: { name, token: 'safe' },
      }),
  });

  const Token = TokenModule<{
    Module: { name: PropertyKey; token: string };
  }>()('Token', ({ Module }) => `${Module.name.toString()}:${Module.token}`);

  expect(Token()).toBe('Token:safe');
});

test('ordinary input transforms must preserve unsupplied dependency fields', () => {
  // @ts-expect-error An ordinary transform cannot drop future dependency fields.
  const DropsDependencies = makeModule({
    transformInput: (deps: object) => {
      void deps;
      return { tag: 'only' as const };
    },
  });
  void DropsDependencies;

  type Base = { required: number };
  type Added = { tag: 'safe' };
  const requiresBase: transformInput<Base, Added> = (deps) =>
    Object.assign(deps, { tag: 'safe' as const });
  const RequiresBase = makeModule({
    transformInput: requiresBase,
  });

  const InlineRequiresBase = makeModule({
    transformInput: <DX extends Base>(deps: DX) =>
      Object.assign(deps, { tag: 'inline' as const }),
  });
  const ReplacesBase = makeModule({
    transformInput: <DX extends { base: unknown }>(deps: DX) =>
      Object.assign(deps, { base: 'replacement' }),
  });
  const AddsUnion = makeModule({
    transformInput: <DX extends Base>(deps: DX) =>
      deps.required > 0
        ? Object.assign(deps, { tag: 'positive' as const })
        : Object.assign(deps, { tag: 'other' as const }),
  });
  const AddsToOpenBase = makeModule({
    transformInput: <DX extends Record<string, unknown>>(deps: DX) =>
      Object.assign(deps, { tag: 'open' as const }),
  });

  const verifyUnsafeTransforms = () => {
    RequiresBase<{ value: number; tag: 'safe' }>()(
      // @ts-expect-error A module must satisfy the transform's input constraint.
      'MissingTransformInput',
      ({ value }) => value
    );
    InlineRequiresBase<{ value: number; tag: 'inline' }>()(
      // @ts-expect-error Inline constrained transforms retain their input domain.
      'MissingInlineTransformInput',
      ({ value }) => value
    );
  };
  void verifyUnsafeTransforms;

  const InlineRead = InlineRequiresBase<{
    required: number;
    value: number;
    tag: 'inline';
  }>()(
    'InlineRead',
    ({ required, value, tag }) => tag + ':' + (required + value)
  );
  expect(InlineRead({ required: 2, value: 3 })).toBe('inline:5');

  const ReadReplaced = ReplacesBase<{ base: string }>()(
    'ReadReplaced',
    ({ base }) => base
  );
  expect(ReadReplaced({ base: 'input' })).toBe('replacement');

  const ReadUnion = AddsUnion<{
    required: number;
    tag: 'positive' | 'other';
  }>()('ReadUnion', ({ tag }) => tag);
  expect(ReadUnion({ required: 1 })).toBe('positive');

  const ReadOpenBase = AddsToOpenBase<{ tag: 'open' }>()(
    'ReadOpenBase',
    ({ tag }) => tag
  );
  expect(ReadOpenBase()).toBe('open');

  const PreservingModule = makeModule({
    transformInput: <D extends object>(deps: D) =>
      Object.assign(deps, { tag: 'safe' as const }),
  });
  const Read = PreservingModule<{ value: number; tag: 'safe' }>()(
    'Read',
    ({ value, tag }) => tag + ':' + value
  );

  expect(Read({ value: 2 })).toBe('safe:2');

  const ReadWithBase = RequiresBase<{
    required: number;
    value: number;
    tag: 'safe';
  }>()(
    'ReadWithBase',
    ({ required, value, tag }) => tag + ':' + (required + value)
  );
  expect(ReadWithBase({ required: 1, value: 2 })).toBe('safe:3');
});

test('custom transform metadata names preserve their declared type', () => {
  const ConstantMetadataModule = makeModule({
    transformInput: <D extends object>(deps: D) =>
      Object.assign(deps, {
        Module: { name: 'Constant' as const },
      }),
  });

  const ReadConstant = ConstantMetadataModule<{
    Module: { name: 'Constant' };
  }>()('ActualKey', ({ Module }) => Module.name);

  expect(ReadConstant()).toBe('Constant');
});

test('transform-supplied fields are removed from caller dependencies', () => {
  const StringValueModule = makeModule({
    transformInput: <D extends object>(deps: D) =>
      Object.assign(deps, { value: 'text' }),
  });

  const ReadValue = StringValueModule<{ value: string }>()(
    'ReadValue',
    ({ value }) => value.toUpperCase()
  );
  expect(ReadValue()).toBe('TEXT');
});

test('custom metadata unions preserve their branch fields', () => {
  type Metadata =
    | { name: PropertyKey; kind: 'token'; token: string }
    | { name: PropertyKey; kind: 'count'; count: number };

  const MetadataModule = makeModule({
    transformInput: <D extends object>(
      deps: D,
      name: PropertyKey
    ): D & { Module: Metadata } =>
      Object.assign(deps, {
        Module: { name, kind: 'token', token: 'safe' } as Metadata,
      }),
  });

  const ReadMetadata = MetadataModule<{ Module: Metadata }>()(
    'ReadMetadata',
    ({ Module }) =>
      Module.kind === 'token' ? Module.token : Module.count.toString()
  );

  expect(ReadMetadata()).toBe('safe');
});

test('makeModule cache=module', () => {
  const Module = makeModule({
    cache: 'module',
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  A({ F });
  A({ F });
  expect(A({ F })).toBe(1);
});

test('makeModule cache=module flushCache', () => {
  const Module = makeModule({
    cache: 'module',
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  A({ F });
  Module.flushCache();
  A({ F });
  expect(A({ F })).toBe(2);
});

test('makeModule cache=module does not retain raw inputs between modules', () => {
  const Module = makeModule({
    cache: 'module',
  });

  const A = Module<{ value: number }>()('A', ({ value }) => value);
  const B = Module<{ value: number }>()('B', ({ value }) => value);

  expect(A({ value: 1 })).toBe(1);
  expect(B({ value: 2 })).toBe(2);
});

test('makeModule cache=run flushCache', () => {
  const Module = makeModule({
    cache: 'run',
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  A({ F });
  Module.flushCache();
  A({ F });
  expect(A({ F })).toBe(3);
});

test('makeModule cache=run', () => {
  const Module = makeModule({
    cache: 'run',
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  type ALive = Live<typeof A>;

  const B = Module<ALive & FLive>()('A', ({ F, A }) => F + A);
  expect(B({ F, A })).toBe(2);
});

test('makeModule cache=run F+A', () => {
  const Module = makeModule({
    cache: 'run',
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  type ALive = Live<typeof A>;

  const B = Module<ALive & FLive>()('A', ({ F, A }) => F + A);
  B({ F, A });
  B({ F, A });
  expect(B({ F, A })).toBe(6);
});

test('makeModule cache=none', () => {
  const Module = makeModule({
    cache: 'none',
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  type ALive = Live<typeof A>;

  const B = Module<ALive & FLive>()('A', ({ F, A }) => F + A);
  expect(B({ F, A })).toBe(3);
});

test('makeModule lazy=true', () => {
  const Module = makeModule({
    lazy: true,
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  expect(A({ F })).toBe(1);
});

test('makeModule lazy=true A->F', () => {
  const Module = makeModule({
    lazy: true,
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', () => 0);
  A({ F });
  expect(i).toBe(0);
});

test('makeModule lazy=false', () => {
  const Module = makeModule({
    lazy: false,
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', () => 0);
  A({ F });
  expect(i).toBe(1);
});

test('makeModule lazy=false A->F', () => {
  const Module = makeModule({
    lazy: false,
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  expect(A({ F })).toBe(1);
});

test('makeModule lazy=false accepts raw dependency values', () => {
  const Module = makeModule({
    lazy: false,
  });

  const A = Module<{ value: number }>()('A', ({ value }) => value * 2);

  expect(A({ value: 5 })).toBe(10);
});

test('lazy=false eagerly resolves each root provider once with cache=none', () => {
  const events: string[] = [];
  const Module = makeModule({ lazy: false, cache: 'none' });

  const A = Module()('A', () => {
    events.push('A');
    return 1;
  });
  const B = Module()('B', () => {
    events.push('B');
    return 2;
  });
  type ALive = Live<typeof A>;
  type BLive = Live<typeof B>;
  const Root = Module<ALive & BLive>()('Root', () => {
    events.push('Root');
    return 0;
  });

  expect(Root({ A, B })).toBe(0);
  expect(events).toEqual(['A', 'B', 'Root']);
});

test('transformOutput receives invocation-local module metadata', () => {
  const events: Array<[PropertyKey, boolean]> = [];
  const Module = makeModule({
    transformOutput: (result, deps, isRoot) => {
      events.push([(<ModuleLive>(<unknown>deps)).Module.name, isRoot]);
      return result;
    },
  });

  const Dependency = Module()('Dependency', () => 1);
  type DependencyLive = Live<typeof Dependency>;
  const Root = Module<DependencyLive>()('Root', ({ Dependency }) => Dependency);

  expect(Root({ Dependency })).toBe(1);
  expect(events).toEqual([
    ['Dependency', false],
    ['Root', true],
  ]);
});

test('transformOutput constrains callback input and defines callable output', () => {
  const StringModule = makeModule({
    transformOutput: (result: number) => result.toFixed(1),
  });
  const Stringified = StringModule()('Stringified', () => 2);
  const result: string = Stringified();
  expect(result).toBe('2.0');

  const FromDependency = StringModule<{ value: number } & ModuleLive>()(
    'FromDependency',
    ({ value }) => value
  );
  const fromDependency: string = FromDependency({ value: 4 });
  expect(fromDependency).toBe('4.0');

  const ReadsOutputDependency = makeModule({
    transformOutput: (result: number, deps: { value: number }) =>
      result + deps.value,
  });
  const WithOutputDependency = ReadsOutputDependency<
    { value: number } & ModuleLive
  >()('WithOutputDependency', ({ value }) => value * 2);
  expect(WithOutputDependency({ value: 3 })).toBe(9);

  const verifyOutputDependencies = () => {
    // @ts-expect-error The output transform requires a dependency missing from this module.
    ReadsOutputDependency()('MissingOutputDependency', () => 1);
  };
  void verifyOutputDependencies;

  const verifyWrongFromDependency = () => {
    StringModule<{ value: number } & ModuleLive>()(
      'WrongFromDependency',
      // @ts-expect-error The output transform accepts number, not string results.
      ({ value }) => {
        return value.toString();
      }
    );
  };
  void verifyWrongFromDependency;

  const verifyOutputInput = () => {
    StringModule()(
      'InvalidOutputInput',
      // @ts-expect-error The output transform accepts only number results.
      () => {
        return { invalid: true };
      }
    );
  };
  void verifyOutputInput;

  const ObservedModule = makeModule({
    transformOutput: (value) => value,
  });
  const Observed = ObservedModule()('Observed', () => 3);
  const observed: number = Observed();
  expect(observed).toBe(3);

  const IdentityModule = makeModule({
    transformOutput: <T>(value: T) => value,
  });
  const Identity = IdentityModule()('Identity', () => 4);
  const identity: number = Identity();
  expect(identity).toBe(4);

  const VoidInputModule = makeModule({
    transformOutput: (result: void) => result === undefined,
  });
  const ValidVoid = VoidInputModule<{ value: number } & ModuleLive>()(
    'ValidVoid',
    ({ value }) => {
      void value;
    }
  );
  const validVoid: boolean = ValidVoid({ value: 1 });
  expect(validVoid).toBe(true);

  const verifyVoidInput = () => {
    // @ts-expect-error TypeScript's contextual void exception must not bypass the transform input.
    VoidInputModule()('InvalidVoidInput', () => 42);
    VoidInputModule<{ value: number } & ModuleLive>()(
      'InvalidVoidFromDependency',
      // @ts-expect-error The output transform accepts only void results.
      ({ value }) => value
    );
  };
  void verifyVoidInput;
});
