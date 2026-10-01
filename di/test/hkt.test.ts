/* eslint-disable require-yield */
import { Live, makeModule, TModule } from '../src';
import { HKT } from '../src/lib/hkt';

type Equal<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends <
  T
>() => T extends Expected ? 1 : 2
  ? true
  : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

// Compare inferred types, including any, without annotating the value under test.
const expectType = <Actual, Expected>(equal: Equal<Actual, Expected>) => {
  expect(equal).toBe(true);
};

test('output HKT derives dependencies from yielded tags', () => {
  let currentDeps: Record<PropertyKey, unknown> = {};
  const Module = makeModule({
    transformOutput: (res, deps) => {
      type UnionToIntersection<U> = [U] extends [never]
        ? object
        : (U extends unknown ? (value: U) => void : never) extends (
            value: infer I
          ) => void
        ? I
        : never;

      type GeneratorModule<
        Name extends PropertyKey,
        Result,
        Deps
      > = Result extends Generator<infer Yielded, infer Returned>
        ? TModule<Name, UnionToIntersection<Yielded>, Returned>
        : TModule<Name, Deps, Result>;

      interface GeneratorHKT extends HKT {
        readonly type: GeneratorModule<
          this['_NAME'],
          this['_RESULT'],
          this['_DEPS']
        >;
      }

      const generator = res as Iterator<unknown, unknown>;
      if (res && typeof generator.next === 'function') {
        currentDeps = deps;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const step = generator.next();
          if (step.done) {
            return step.value as unknown as GeneratorHKT;
          }
        }
      }

      return res as unknown as GeneratorHKT;
    },
  });

  type Tag<N extends PropertyKey, R> = {
    readonly _tag: 'tag';
    readonly name: N;
    [Symbol.iterator](): Generator<Live<TModule<N, object, R>>, R, unknown>;
  };

  const Tag =
    <N extends PropertyKey>(name: N) =>
    <R>(): Tag<N, R> => {
      return {
        _tag: 'tag' as const,
        name,
        [Symbol.iterator]: function* () {
          return currentDeps[name] as R;
        },
      } satisfies Tag<N, R>;
    };

  const B = Module()('B', function* () {
    return {
      getTime: () => 1_000_000,
    };
  });

  const B_ = Tag('B')<{ getTime(): number }>();
  const C_ = Tag('C')<{ get(): number }>();

  const A = Module()('A', function* () {
    const b = yield* B_;
    const cx = yield* C_;

    return b.getTime() + cx.get();
  });

  expectType<IsAny<typeof A>, false>(true);
  expectType<typeof A.name, 'A'>(true);
  expectType<ReturnType<typeof A>, number>(true);

  const verifyDependencies = () => {
    // @ts-expect-error Yielded tags become required module dependencies.
    A();
    // @ts-expect-error Every yielded tag becomes a required dependency.
    A({ B });
    // @ts-expect-error Dependency values keep the yielded tag's result type.
    A({ B, C: { get: () => 'wrong' } });
  };
  void verifyDependencies;

  const result = A({
    B,
    C: {
      get() {
        return 2;
      },
    },
  });
  expectType<typeof result, number>(true);
  expect(result).toBe(1_000_002);
});

test('input HKT wraps the declared dependencies and preserves literal results', () => {
  const Module = makeModule({
    transformInput: (deps) => {
      type Wrap<T> = { wrap: T };

      interface WrapHKT extends HKT {
        readonly type: Wrap<this['_RESULT']>;
      }

      return { wrap: deps } as unknown as WrapHKT;
    },
  });
  const A = Module<{ path: 1 }>()('A', (deps) => {
    expectType<typeof deps.wrap, { path: 1 }>(true);
    return deps.wrap.path;
  });

  const result = A({ path: 1 });
  expectType<typeof result, 1>(true);
  expect(result).toBe(1);

  const ReadHktNamedDependency = Module<{ _NAME: string }>()(
    'ReadHktNamedDependency',
    (deps) => deps.wrap._NAME.toUpperCase()
  );
  const verifyHktKeysAreNotRuntimeDeps = () => {
    // @ts-expect-error HKT marker keys are not supplied runtime dependencies.
    ReadHktNamedDependency();
  };
  void verifyHktKeysAreNotRuntimeDeps;
  const namedResult = ReadHktNamedDependency({ _NAME: 'value' });
  expectType<typeof namedResult, string>(true);
  expect(namedResult).toBe('VALUE');
});

test('input HKT receives the module name separately from dependency slots', () => {
  const HktModule = makeModule({
    transformInput: (deps, name) => {
      type InputShape<Name, Result, Deps> = {
        readonly name: Name;
        readonly result: Result;
        readonly deps: Deps;
      };

      interface InputHKT extends HKT {
        readonly type: InputShape<
          this['_NAME'],
          this['_RESULT'],
          this['_DEPS']
        >;
      }

      return { name, result: deps, deps } as unknown as InputHKT;
    },
  });

  const Named = HktModule<{ value: number }>()('Named', (input) => {
    expectType<typeof input.name, 'Named'>(true);
    expectType<typeof input.result, { value: number }>(true);
    expectType<typeof input.deps, { value: number }>(true);
    expectType<typeof input.result.value, number>(true);
    expectType<typeof input.deps.value, number>(true);
    return input.name + ':' + (input.result.value + input.deps.value);
  });

  const result = Named({ value: 2 });
  expectType<typeof result, string>(true);
  expect(result).toBe('Named:4');
});

test('ordinary transform results cannot accidentally become HKT markers', () => {
  const Module = makeModule({
    transformInput: <D extends object>(deps: D) =>
      Object.assign(deps, { _NAME: 'ordinary' as const }),
  });

  const Read = Module<{ value: number }>()('Read', ({ value }) => value * 2);

  expect(Read({ value: 3 })).toBe(6);
});

test('input and output HKT compose through provide and nested Live dependencies', () => {
  type Wrapped<D> = { wrapped: D };
  interface WrappedInput extends HKT {
    readonly type: Wrapped<this['_DEPS']>;
  }
  type Boxed<N extends PropertyKey, D, R> = TModule<N, D, { value: R }>;
  interface BoxedOutput extends HKT {
    readonly type: Boxed<this['_NAME'], this['_DEPS'], this['_RESULT']>;
  }

  const Module = makeModule({
    transformInput: (deps) => ({ wrapped: deps } as unknown as WrappedInput),
    transformOutput: (result) => ({ value: result } as unknown as BoxedOutput),
  });
  const Sum = Module<{ left: number; right: number }>()(
    'Sum',
    ({ wrapped }) => wrapped.left + wrapped.right
  );

  const direct = Sum({ left: 2, right: 3 });
  expectType<typeof direct, { value: number }>(true);
  expectType<typeof Sum.name, 'Sum'>(true);
  expectType<typeof Sum.Live, Live<typeof Sum>>(true);
  expectType<IsAny<typeof Sum.Live>, false>(true);
  expect(direct).toEqual({ value: 5 });

  const WithLeft = Sum.provide({ left: 4 });
  const partial = WithLeft({ right: 5 });
  expectType<typeof partial, { value: number }>(true);
  expectType<typeof WithLeft.Live, Live<typeof WithLeft>>(true);
  expectType<typeof WithLeft.Live.right, number>(true);
  expectType<typeof WithLeft.Live.Sum, { value: number }>(true);
  expect(partial).toEqual({ value: 9 });

  const Bound = WithLeft.provide({ right: 6 });
  const bound = Bound();
  expectType<typeof bound, { value: number }>(true);
  expectType<typeof Bound.name, 'Sum'>(true);
  expectType<Live<typeof Bound>, { Sum: { value: number } }>(true);
  expectType<typeof Bound.Live, { Sum: { value: number } }>(true);
  expect(bound).toEqual({ value: 10 });

  const Doubled = Module<typeof WithLeft.Live>()('Doubled', ({ wrapped }) => {
    expectType<typeof wrapped.Sum, { value: number }>(true);
    expectType<typeof wrapped.right, number>(true);
    return wrapped.Sum.value * 2;
  });
  const Root = Module<typeof Doubled.Live>()('Root', ({ wrapped }) => {
    expectType<typeof wrapped.Doubled, { value: number }>(true);
    return wrapped.Doubled.value + 1;
  });
  const nested = Root({ Doubled, Sum: WithLeft, right: 7 });
  expectType<typeof nested, { value: number }>(true);
  expect(nested).toEqual({ value: 23 });

  const readBound = Doubled.provide({ Sum: Bound, right: 100 })();
  expectType<typeof readBound, { value: number }>(true);
  expect(readBound).toEqual({ value: 20 });

  const verifyContracts = () => {
    // @ts-expect-error The input wrapper does not become a caller dependency.
    Sum({ wrapped: { left: 2, right: 3 } });
    // @ts-expect-error One partial binding does not supply the other dependency.
    WithLeft();
    // @ts-expect-error Chained provide preserves the remaining dependency type.
    WithLeft.provide({ right: 'wrong' });
    // @ts-expect-error HKT-derived modules still reject unknown partial keys.
    Sum.provide({ missing: 1 });
    // @ts-expect-error A boxed result cannot be replaced with its unboxed value.
    Doubled({ Sum: 5, right: 7 });
    // @ts-expect-error Nested provider requirements survive Live extraction.
    Root({ Doubled, Sum: WithLeft });
    // @ts-expect-error The output HKT preserves the boxed payload type.
    direct.value.toUpperCase();
  };
  void verifyContracts;
});
