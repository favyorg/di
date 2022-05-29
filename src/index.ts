const Deps = Symbol('Deps');
const Create = Symbol('Create');
const ModuleName = Symbol('ModuleName');
const ModuleTag = Symbol('Module');
const ExtractDeps = Symbol('ExtractDeps');
const Live = Symbol('Live');
const Cache = Symbol('Cache');

type SystemKeys = typeof Deps | typeof ExtractDeps | typeof Live;

type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (x: infer R) => any ? R : never;

type OmitWithFn<T> = T extends ((...args: infer A) => infer R) & infer O ? ((...deps: A) => R) & Omit<O, SystemKeys> : Omit<T, SystemKeys>;

type LocalDeps<D, ROOT extends boolean = true> = {
  [k in keyof D]: D[k] extends {
    [Deps]?: infer DD;
    [Live]?: true;
  }
    ? OmitWithFn<D[k]> | ((deps: ROOT extends true ? ModuleDeps<DD, true> : DD) => OmitWithFn<D[k]>)
    : OmitWithFn<D[k]>;
};

export type ModuleDeps<D, ROOT extends boolean = true> = LocalDeps<D, ROOT> &
  UnionToIntersection<
    {
      [k in keyof D]: D[k] extends {
        [Deps]?: infer DD;
        [ExtractDeps]?: true;
      }
        ? ModuleDeps<DD, true>
        : never;
    }[keyof D]
  >;

type ModuleArgs<M> = unknown extends M ? [] : [ModuleDeps<M>];

type ModuleLike<N extends keyof any, A, D, R> = { name: N } & ((deps: A) => R) & { [Deps]?: D };

type WithDeps<D, R> = (unknown extends R ? {} : R) & {
  [Deps]?: D;
};

export type LiveDeps<D, R> = WithDeps<D, R> & { [Live]?: true } & { [ExtractDeps]?: true };

export type Live<T> = {
  [k in keyof Omit<T, SystemKeys>]: T[k] extends ModuleLike<k, any, infer D, infer R> ? LiveDeps<D, R> : never;
};

export type Create<T> = {
  [k in keyof Omit<T, SystemKeys> as `create${k extends string ? k : never}`]: T;
};

export function Module<D extends unknown, R extends unknown = unknown, N extends string = string>(
  this: unknown,
  name: N,
  create: (deps: D) => R,
) {
  function fn(...args: ModuleArgs<D>) {
    const deps = args[0] ?? {};
    // @ts-ignore
    const resDeps = this?.[Cache] ? this : { [Cache]: true };

    for (let k in deps) {
      if (k in resDeps) {
        continue;
      }

      // @ts-ignore
      if (deps[k]?.tag === ModuleTag) {
        Object.defineProperty(resDeps, k, {
          get: () => {
            // @ts-ignore
            const value = deps[k][ModuleName] === k ? deps[k].call(resDeps, deps) : deps[k];

            Object.defineProperty(resDeps, k, {
              value,
            });

            return value;
          },
          enumerable: false,
          configurable: true,
        });
      } else {
        // @ts-ignore
        resDeps[k] = deps[k];
      }
    }

    return create(resDeps as D);
  }

  // fix never
  (fn as any)[Create] = create;
  (fn as any).tag = ModuleTag;
  (fn as any)[ModuleName] = name;

  // @ts-expect-error
  fn[name] = fn;

  type System = typeof fn & {
    [Deps]?: D;
    [Live]?: false;
    [ExtractDeps]?: false;
  };

  const typedFn = fn as System;

  type Module<T> = typeof typedFn & {
    [k in N]: typeof typedFn & {
      name: N;
    };
  };

  return typedFn as Module<D>;
}

export type ModuleFn<D, R> = (deps: D) => R;

export type Module<NAME extends string, DEPS, RETURN> = ModuleFn<DEPS, RETURN> & {
  [k in NAME]: ModuleFn<DEPS, RETURN> & {
    name: NAME;
  };
} & {
  [Deps]?: DEPS;
  [Live]?: false;
  [ExtractDeps]?: false;
};

export function Service<D extends unknown, R extends unknown = unknown, N extends string = string>(
  this: unknown,
  name: N,
  create: (deps: D) => R,
) {
  let result: R;
  let isCalled = false;

  return Module(name, (deps: D) => {
    if (!isCalled) {
      result = create(deps);
      isCalled = true;
    }

    return result;
  });
}
