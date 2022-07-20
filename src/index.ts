const Deps = Symbol('Deps');
const Create = Symbol('Create');
const ModuleName = Symbol('ModuleName');
const ModuleTag = Symbol('Module');
const ExtractDeps = Symbol('ExtractDeps');
const Live = Symbol('Live');
const Cache = Symbol('Cache');

type SystemKeys = typeof Deps | typeof ExtractDeps | typeof Live | "provide";

type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (x: infer R) => any ? R : never;

type OmitWithFn<T> = T extends ((...args: infer A) => infer R) & infer O ? ((...deps: A) => R) & Omit<O, SystemKeys> : Omit<T, SystemKeys>;

type LocalDeps<LOCAL_DEPS, ROOT extends boolean = true> = {
  [NAME in keyof LOCAL_DEPS]: LOCAL_DEPS[NAME] extends {
    [Deps]?: infer DEEP_DEPS;
    [Live]?: true;
  }
    ? OmitWithFn<LOCAL_DEPS[NAME]> | ((deps: ROOT extends true ? ModuleDeps<DEEP_DEPS, true> : DEEP_DEPS) => OmitWithFn<LOCAL_DEPS[NAME]>)
    : OmitWithFn<LOCAL_DEPS[NAME]>;
};

export type ModuleDeps<DEPS, ROOT extends boolean = true> = LocalDeps<DEPS, ROOT> &
  UnionToIntersection<
    {
      [NAME in keyof DEPS]: DEPS[NAME] extends {
        [Deps]?: infer DEEP_DEPS;
        [ExtractDeps]?: true;
      }
        ? ModuleDeps<DEEP_DEPS, true>
        : never;
    }[keyof DEPS]
  >;

type ModuleArgs<MODULE> = unknown extends MODULE ? [] : [ModuleDeps<MODULE>];

type ModuleLike<NAME extends keyof any, LOCAL_DEPS, DEEP_DEPS, RETURN> = { name: NAME } & ((deps: LOCAL_DEPS) => RETURN) & { [Deps]?: DEEP_DEPS };

type WithDeps<DEPS, RETURN> = (unknown extends RETURN ? {} : RETURN) & {
  [Deps]?: DEPS;
};

export type LiveDeps<DEPS, RETURN> = WithDeps<DEPS, RETURN> & { [Live]?: true } & { [ExtractDeps]?: true };

export type Live<MODULE> = {
  [NAME in keyof Omit<MODULE, SystemKeys>]: MODULE[NAME] extends ModuleLike<NAME, any, infer DEPS, infer RETURN> ? LiveDeps<DEPS, RETURN> : never;
};

export type Create<T> = {
  [k in keyof Omit<T, SystemKeys> as `create${k extends string ? k : never}`]: T;
};

export function Module<DEPS extends unknown, RETURN extends unknown = unknown, NAME extends string = string>(
  this: unknown,
  name: NAME,
  create: (deps: DEPS) => RETURN,
) {
  function fn(...args: ModuleArgs<DEPS>) {
    const deps = Object.assign({}, ...args)
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
            const value = deps[k].call(resDeps, deps)

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

    return create(resDeps as DEPS);
  }

  const pathFn = (fn: Function) => {
    // fix never
    (fn as any)[Create] = create;
    (fn as any).tag = ModuleTag;
    (fn as any)[ModuleName] = name;

    // @ts-expect-error
    fn[name] = fn;

    // @ts-ignore
    fn.provide = (deps: DEPS) => pathFn(fn.bind(fn, deps))

    return fn
  }

  pathFn(fn);

  type System = typeof fn & {
    [Deps]?: DEPS;
    [Live]?: false;
    [ExtractDeps]?: false;
  };

  type Module<M_DEPS, F> = F & {
    [k in NAME]: F & {
      name: NAME;
    }
  } & {
    provide<
      ARGS extends ModuleArgs<M_DEPS>,
      DEPS extends ARGS[0],
      SOME_DEPS extends Partial<DEPS>,
      NEXT_DEPS extends Omit<DEPS, keyof SOME_DEPS>
    >(someDeps: SOME_DEPS): Module<NEXT_DEPS, (deps: NEXT_DEPS) => RETURN>
  };

  return fn as Module<DEPS, System>;
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
