/* eslint-disable */
import type { HKT, Kind } from './hkt';
import type { ModuleLive } from './module';

const __deps__ = Symbol('Deps');


type Create<P, R> = {} extends P
  ? { (): R }
  : {
      (deps: P): R;
    };

type Callable<D, R, C> = D extends undefined ? { (): R } : Create<C, R>;

export type TModule<
  KEY extends PropertyKey,
  RESULT,
  DEPS = undefined,
  PROV_DEPS = undefined,
  CREATE = Omit<
    DEPS extends { [__deps__]?: infer R } ? R & Omit<DEPS, keyof R> : DEPS,
    keyof PROV_DEPS
  >
> = {
  [key in KEY]: Callable<DEPS, RESULT, CREATE>;
} & Callable<DEPS, RESULT, CREATE> & {
    provide<PD extends Partial<CREATE>>(
      deps: PD
    ): TModule<KEY, RESULT, DEPS, PROV_DEPS, Omit<CREATE, keyof PD>>;
    Live: Live<TModule<KEY, RESULT, DEPS, PROV_DEPS>>;
  } & Generator<
    TModule<KEY, RESULT, DEPS, PROV_DEPS, CREATE>,
    RESULT, //TModule<KEY, RESULT, DEPS, PROV_DEPS, CREATE>,
    {}
  >;

export type Live<T> = T extends TModule<
  infer K extends PropertyKey,
  infer R,
  infer D,
  infer PD
>
  ? {
      [k in K]: R;
    } & {
      [__deps__]?: {
        [k in K]: T[k] | R;
      } & {
        [k in K]: T[k] extends (deps: infer D) => infer R ? D : never;
      }[K];
    }
  : never;

export type transformInput<D, M, PD> = (deps: D, name: PropertyKey) => PD;
export type transformOutput<I, D, O> = (result: I, deps: D, isRoot: boolean) => O;

export type MakeOptions<D, M, PD, I, O> = {
  transformInput?: transformInput<D, M, PD>;
  transformOutput?: transformOutput<I, transformInput<D, M, PD>, O>;
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
}) satisfies transformInput<any, any, ModuleLive>;

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

      // return module as TModule<
      //   N,
      //   O extends HKT
      //     ? Kind<O, RR, PD extends HKT ? Kind<PD, ND, ND, ND> : ND, RR>
      //     : RR,
      //   ND,
      //   PD
      // >;

      return module as O extends HKT ? Kind<O, N, RR, ND, PD, never> : TModule<N, RR, ND, PD>;

    };

  createModule.flushCache = () => {
    globalCacheStore = new Cache();
  };

  return createModule;
};
