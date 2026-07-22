/* eslint-disable require-yield */
import { Live, makeModule, TModule } from '../src';
import { HKT } from '../src/lib/hkt';

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

  type IsAny<T> = 0 extends 1 & T ? true : false;
  const aIsTyped: IsAny<typeof A> = false;
  expect(aIsTyped).toBe(false);

  const verifyDependencies = () => {
    // @ts-expect-error Yielded tags become required module dependencies.
    A();
    // @ts-expect-error Every yielded tag becomes a required dependency.
    A({ B });
    // @ts-expect-error Dependency values keep the yielded tag's result type.
    A({ B, C: { get: () => 'wrong' } });
  };
  void verifyDependencies;

  const result: number = A({
    B,
    C: {
      get() {
        return 2;
      },
    },
  });
  expect(result).toBe(1_000_002);
});

test('---', () => {
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
    return deps.wrap.path;
  });

  expect(A({ path: 1 })).toBe(1);

  const ReadHktNamedDependency = Module<{ _NAME: string }>()(
    'ReadHktNamedDependency',
    (deps) => deps.wrap._NAME.toUpperCase()
  );
  const verifyHktKeysAreNotRuntimeDeps = () => {
    // @ts-expect-error HKT marker keys are not supplied runtime dependencies.
    ReadHktNamedDependency();
  };
  void verifyHktKeysAreNotRuntimeDeps;
  expect(ReadHktNamedDependency({ _NAME: 'value' })).toBe('VALUE');
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
    const name: 'Named' = input.name;
    const result: number = input.result.value;
    const dependency: number = input.deps.value;
    return name + ':' + (result + dependency);
  });

  expect(Named({ value: 2 })).toBe('Named:4');
});

test('ordinary transform results cannot accidentally become HKT markers', () => {
  const Module = makeModule({
    transformInput: <D extends object>(deps: D) =>
      Object.assign(deps, { _NAME: 'ordinary' as const }),
  });

  const Read = Module<{ value: number }>()('Read', ({ value }) => value * 2);

  expect(Read({ value: 3 })).toBe(6);
});

// test('---', () => {
//   const Module = makeModule({
//     transformOutput: (value: any) => {
//       type G<A extends PropertyKey, DEPS, RES> = RES extends Generator<
//         infer Y,
//         infer R
//       >
//         ? TModule<A, (R | Y)[], DEPS>
//         : never;
//       interface GeneratorHKT extends HKT {
//         readonly type: G<this['_NAME'], this['_DEPS'], this['_RESULT']>;
//       }

//       return [...value] as any as GeneratorHKT;
//     },
//   });

//   const A = Module()('A', function* () {
//     yield 1;
//     yield 2;
//     yield 3;
//   });

//   const B = Module<Live<typeof A>>()('B', function* ({ A }) {
//     yield* A;
//     yield 4;
//     yield 5;
//     yield 6;
//   });

//   const result = B({ A });

//   expect(result).toEqual([1, 2, 3, 4, 5, 6]);
// });
