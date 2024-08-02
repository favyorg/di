/* eslint-disable */
import type { HKT, Kind } from './hkt';
import type { ModuleLive } from './module';

const __deps__ = '__deps__'; // Symbol('Deps');

type Create<P, R> = {} extends P
  ? { (): R }
  : {
      (deps: P): R;
    };

// type Callable<D, R, C> = { (): R }; // D extends undefined ? { (): R } : Create<C, R>;

type ProvideDeps<D> = {
  [k in keyof D]: D[k] | ((deps: any) => D[k]);
};

export type TModule<KEY extends PropertyKey, D, R> = ((
  ...args: {} extends D ? [] : [deps: ProvideDeps<D>]
) => R) & {
  name: KEY;
  //[key in KEY]: Callable<DEPS, RESULT, DEPS>;
} & {
  provide<PD extends Partial<ProvideDeps<D>>>(
    ...args: {} extends D ? [] : [deps: PD]
  ): TModule<KEY, Omit<D, keyof PD>, R>;
};

export type Live<T> = T extends TModule<
  infer K extends PropertyKey,
  infer D,
  infer R
>
  ? D & {
      [k in K]: R;
    }
  : never;

// & Generator<TModule<N, Omit<ND, keyof PD>, RR>, RR, {}>

export type transformInput<D, PD> = (deps: D, name: PropertyKey) => PD;
export type transformOutput<I, D, O> = (
  result: I,
  deps: D,
  isRoot: boolean
) => O;

export type MakeOptions<D, M, PD, I, O> = {
  transformInput?: transformInput<D, PD>;
  transformOutput?: transformOutput<I, transformInput<D, PD>, O>;
  /**
   * @default run
   * cache = run | undefined
   * ```ts
   * let i = 0;
   * const A = Module()('A', ++i);
   * type ALive = Live<typeof A>;
   *
   * const B = Module<A>({ A })('B', A);
   * type BLive = Live<typeof B>;
   *
   * const C = Module<A & B>({ A, B })('C', A + B);
   * C() // 2 because module A was called 1 time (1 + 1)
   * C() // 4 because module A was called 1 time (2 + 2)
   *
   * ```
   * cache = module
   * ```ts
   * const Module = makeModule({
   *    cache: 'module'
   * });
   * let i = 0;
   * const A = Module()('A', ++i);
   * type ALive = Live<typeof A>;
   *
   * const B = Module<A>({ A })('B', A);
   * type BLive = Live<typeof B>;
   *
   * const C = Module<A & B>({ A, B })('C', A + B);
   * C() // 2 because module A was called 1 time (1 + 1)
   * C() // 2 because module A was called 1 time (1 + 1)
   *
   * ```
   * cache = none
   * ```ts
   * const Module = makeModule({
   *    cache: 'none'
   * });
   * let i = 0;
   * const A = Module()('A', ++i);
   * type ALive = Live<typeof A>;
   *
   * const B = Module<A>({ A })('B', A);
   * type BLive = Live<typeof B>;
   *
   * const C = Module<A & B>({ A, B })('C', A + B);
   * C() // 3 because module A was called 2 times (1 + 2)
   * C() // 7 because module A was called 2 times (3 + 4)
   * ```
   */
  cache?: 'run' | 'module' | 'none';
  lazy?: boolean;
};

export const withModuleName = (<D, M>(
  deps: D,
  name: PropertyKey
): ModuleLive => {
  return Object.assign(deps as any, {
    Module: {
      name,
    },
  });
}) satisfies transformInput<any, ModuleLive>;

class Cache {}

export const makeModule = <
  D extends { [__deps__]?: true },
  PD,
  M extends <DX>(deps: DX) => DX,
  I,
  O
>(
  options: MakeOptions<D, M, PD, I, O>
) => {
  const {
    cache = 'run',
    lazy = true,
    transformInput = withModuleName,
    transformOutput = <T>(value: T, isRoot: boolean) => value,
  } = typeof options === 'function'
    ? {
        transformInput: options,
      }
    : options;

  let globalCacheStore: any = new Cache();

  const createModule =
    <ND = PD>() =>
    <const N extends PropertyKey, const RR = void>(
      name: N,
      fn: (deps: PD extends HKT ? Kind<PD, ND, ND, ND, never, never> : ND) => RR
    ) => {
      const module: any = function (this: any, ...depsList: any) {
        const deps = Object.assign({}, ...depsList);
        const isRoot = typeof this !== 'object' || !(this instanceof Cache);
        let resDeps: Record<any, any> = !isRoot ? this : new Cache();

        if (cache === 'module') {
          resDeps = globalCacheStore;

          if (
            resDeps.hasOwnProperty(name) &&
            Object.getOwnPropertyDescriptor(resDeps, name)?.get === undefined
          ) {
            return resDeps[name];
          }
        }

        if (isRoot) {
          for (const k in deps) {
            if (resDeps.hasOwnProperty(k)) continue;

            if (deps[k].hasOwnProperty(__deps__)) {
              Object.defineProperty(resDeps, k, {
                get: () => {
                  const value = deps[k].call(resDeps, deps);

                  if (cache !== 'none') {
                    Object.defineProperty(resDeps, k, {
                      value,
                    });
                  }

                  return value;
                },
                enumerable: false,
                configurable: true,
              });
            } else {
              resDeps[k] = deps[k];
            }
          }

          if (!lazy) {
            for (const k in deps) {
              deps[k].call(resDeps, deps);
            }
          }
        }

        const transformedDeps = transformInput(resDeps, name);
        const res = transformOutput(
          fn(transformedDeps as any) as any,
          transformedDeps as any,
          isRoot
        );

        if (cache === 'module') {
          Object.defineProperty(resDeps, name, {
            value: res,
            writable: true,
          });
        }

        return res;
      };

      module[name] = module;
      module.provide = function (partialDeps: any) {
        return module.bind(this, partialDeps);
      };
      module[__deps__] = true;

      return module as O extends HKT
        ? Kind<O, N, RR, Omit<ND, keyof PD>, never, never>
        : TModule<N, Omit<ND, keyof PD>, RR>;
    };

  createModule.flushCache = () => {
    globalCacheStore = new Cache();
  };

  return createModule;
};
