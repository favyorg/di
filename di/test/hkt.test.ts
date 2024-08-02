/* eslint-disable require-yield */
import { Live, makeModule, TModule } from '../src';
import { HKT } from '../src/lib/hkt';

test('Custom module(ask gen deps)', () => {
  const Module = makeModule({
    transformOutput: (res, deps, isRoot) => {
      type UnionToIntersection<U> =
        (U extends any ? (x: U)=> void : never) extends ((x: infer I) => void) ? I : never

      type Gen<A extends PropertyKey, RES, DEPS, P, C> =
        RES extends Generator<infer Y, infer R> ?
          TModule<A, R, UnionToIntersection<Y>, P> :
          TModule<A, RES, DEPS, P>;

      interface GenHKT extends HKT {
        readonly type: Gen<this['_NAME'], this['_RESULT'], this['_DEPS'], this['_PROV_DEPS'], this['_CREATE']>;
      }

      if (isRoot || (res as any).next) {
        (Module as any)._deps = deps;
        // eslint-disable-next-line no-constant-condition
        while(true) {
          const x = (res as any).next();
          if (x.done) {
            return x.value;
          }
        }
      }

      return res as any as GenHKT;
    },
  });

  type Tag<N extends PropertyKey, R> = Generator<Live<TModule<N, R>>, R>;

  const Tag = <N extends PropertyKey>(name: N) => <R>() => {
    return {
      _tag: 'tag',
      name,
      [Symbol.iterator]: function* () {
        return (Module as any)._deps[name];
      }
    } as any as Tag<N, R>;
  }

  const B = Module()('B', function *() {
    return {
      getTime: () => 1_000_000
    }
  });

  const B_ = Tag('B')<{ getTime(): number }>();
  const C_ = Tag('C')<{ get(): number }>();

  const A = Module()('A', function *() {
    const b = yield* B_;
    const cx = yield* C_;

    return b.getTime() + cx.get();
  });

  expect(A({
    B,
    C: { get(){ return 2 } }
  })).toBe(1_000_002);
});

test('---', () => {
  const Module = makeModule({
    transformInput: (deps, name) => {
      type Wrap<T> = { wrap: T };

      interface WrapHKT extends HKT {
        readonly type: Wrap<this['_RESULT']>;
      }

      return { wrap: deps } as any as WrapHKT;
    },
  });
  const A = Module<{ path: 1 }>()('A', (deps) => {
    return deps.wrap.path;
  });

  expect(A({ path: 1 })).toBe(1);
});

test('---', () => {
  const Module = makeModule({
    transformOutput: (value: any) => {
      type G<A extends PropertyKey, RES, DEPS, P, C> = RES extends Generator<infer Y, infer R> ? TModule<A, (R | Y)[], DEPS, P> : never;
      interface GeneratorHKT extends HKT {
        readonly type: G<this['_NAME'], this['_RESULT'], this['_DEPS'], this['_PROV_DEPS'], this['_CREATE']>;
      }

      return [...value] as any as GeneratorHKT;
    },
  });

  const A = Module()('A', function* () {
    yield 1;
    yield 2;
    yield 3;
  });

  const B = Module<(typeof A)['Live']>()('B', function* ({ A }) {
    yield* A;
    yield 4;
    yield 5;
    yield 6;
  });

  const result = B({ A });

  expect(result).toEqual([1, 2, 3, 4, 5, 6]);
});
