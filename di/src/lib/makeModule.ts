/* eslint-disable */
import type { HKT, Kind } from './hkt';
const __deps__ = Symbol('Deps');
type Key = PropertyKey;
// D = dependencies, C = full context, P = provided values, R = result.
type Brand<in D, out R> = { result: R; accepts: (deps: D) => 0 };
// Flatten structural aliases for speed while preserving nominal contexts.
type Flat<D> = 0 extends 1 & D ? D : D extends unknown ? { [K in keyof D]: D[K] } : never;
type ProviderDeps<D> = Flat<D> extends D ? Flat<D> : D;
type Provider<R, D> = ((deps: any) => R) & { readonly [__deps__]: Brand<ProviderDeps<D>, R> };
type Keys<D> = D extends unknown ? keyof D : never;
// Collapse empty structural maps but keep keyless nominal and callable types.
type KeylessDeps<D> = {} extends D ? {} : D;
type ModuleDeps<D> = [D] extends [never] ? never : Keys<D> extends never ? KeylessDeps<D> : D;
type Each<D, K extends Key> = D extends unknown ? Omit<D, K> : never;
type Required<D> = { [K in keyof D]-?: {} extends Pick<D, K> ? never : K }[keyof D];
type Value<T> = T extends object ? T & { readonly [__deps__]?: never } : T;
type Deps<D, C = D> = D extends unknown ? { [K in keyof D]: Value<D[K]> | Provider<D[K], C extends D ? C : never> } : never;
type Args<D, C> = Keys<D> extends never ? [] : {} extends D ? [deps?: Deps<D, C>] : [deps: Deps<D, C>];
type Rest<D, P, Keep = false> = D extends unknown
  ? P extends Partial<Deps<D, Keep extends true ? D : any>>
    ? Keep extends true ? D : Omit<D, Extract<Required<P>, keyof D>>
    : never
  : never;
type Exact<D, P> = P & Record<Exclude<Keys<P>, Keys<D>>, never>;
export type TModule<N extends Key, D, R, C = D> = {
  (...args: Args<D, C>): R;
  readonly name: N;
  readonly [__deps__]: Brand<ModuleDeps<D>, R>;
  provide<const P extends Partial<Deps<D, C>> = {}>(
    ...args: {} extends D ? [deps?: Exact<D, P>] : [deps: Exact<D, P>]
  ): TModule<N, Flat<Rest<D, P>>, R, Rest<C, P, true>>;
};
export type Live<T> = T extends { name: infer N extends Key; [__deps__]: Brand<infer D, infer R> }
  ? D & { [K in N]: R } : never;
export type transformInput<D extends object, P extends object> = <X extends D>(deps: X, name: Key) => X & P;
export type transformOutput<I, D, O> = (result: I, deps: D, root: boolean) => O;
type Lifecycle = { cache?: 'run' | 'module' | 'none'; lazy?: boolean };
export type MakeOptions<D, M, P, I, O> = Lifecycle & {
  transformInput?: transformInput<D & object, P & object>;
  transformOutput?: transformOutput<I, D & P & object, O>;
};
type Named<N extends Key = Key> = { Module: { name: N } };
type InputFn = (deps: any, name: Key) => object;
type OutputFn<D = any> = (result: any, deps: D, root: boolean) => any;
type OutputContext<O, D> = [O] extends [never] ? unknown : [O] extends [OutputFn<D>] ? unknown : never;
type Identity<I> = (<T>(result: T) => T) & ((result: I) => 0);
type Domain<F extends InputFn> = Parameters<F>[0] extends object ? Parameters<F>[0] : object;
type Known<K> = K extends Key
  ? string extends K ? never : number extends K ? never : symbol extends K ? never : K
  : never;
type Added<F extends InputFn> = ReturnType<F> extends HKT
  ? ReturnType<F>
  : ReturnType<F> extends Domain<F> & infer P
    ? unknown extends P ? {} : Each<P, Known<keyof Domain<F>>>
    : ReturnType<F>;
type Valid<F extends InputFn> = ReturnType<F> extends HKT
  ? F : F extends transformInput<Domain<F>, Added<F>> ? F : never;
type Needed<P, D> = P extends HKT ? D : Each<D, Required<P>>;
type Input<P, N extends Key, D> = P extends HKT ? Kind<P, N, D, D, never, never> : D;
type Accepts<O> = [O] extends [never] ? unknown : O extends OutputFn ? Parameters<O>[0] : never;
type Result<O, N extends Key, R, D> = [O] extends [never]
  ? TModule<N, D, R>
  : O extends OutputFn
    ? O extends <T>(result: T) => T
      ? TModule<N, D, R>
      : ReturnType<O> extends HKT
        ? Kind<ReturnType<O>, N, R, D, never, never>
        : O extends <T>(result: T, ...args: any) => T
          ? TModule<N, D, R> : TModule<N, D, ReturnType<O>>
    : never;
type Factory<T extends object, P, O = never> = {
  <D extends object = P extends HKT ? T : T & P>(): <
    const N extends Key,
    const F extends (deps: Input<P, N, D>) => Accepts<O>
  >(name: Needed<P, D> extends T ? N & OutputContext<O, Input<P, N, D>> : never, fn: F) =>
    Result<O, N, ReturnType<F>, Needed<P, D>>;
  flushCache(): void;
};
export type DefaultModuleFactory = Factory<object, Named>;
type WithName = typeof withModuleName;
type Make = {
  (options?: Lifecycle & { transformInput?: undefined | WithName; transformOutput?: undefined }): Factory<object, Named>;
  <O extends OutputFn>(options: Lifecycle & { transformInput?: undefined | WithName; transformOutput: O }): Factory<object, Named, O>;
  <I extends InputFn, O extends OutputFn | undefined = undefined>(options: Lifecycle & {
    transformInput: I & Valid<I>; transformOutput?: O;
  }): Factory<Domain<I>, Added<I>, O extends OutputFn ? O : never>;
  <D, M, P, I, O>(options: MakeOptions<D, M, P, I, O>): Factory<
    D & object, P & object, transformOutput<I, D & P & object, O> | Identity<I>
  >;
  (transform: WithName): Factory<object, Named>;
  <I extends InputFn>(transform: I & Valid<I>): Factory<Domain<I>, Added<I>>;
};
export const withModuleName = <D extends object, const N extends Key>(deps: D, name: N):
  Each<D, 'Module'> & Named<N> =>
  Object.assign(deps, { Module: { name } }) as any;
// Getters push and restore this shared state synchronously during nested calls.
let activeContext: object | undefined;
let activeMetadata: object | undefined;
const own = Object.hasOwn;
const define = Object.defineProperty;
const getDescriptor = Object.getOwnPropertyDescriptor;
const keys = (value: object) => {
  const result: Key[] = Object.getOwnPropertyNames(value);
  result.push(...Object.getOwnPropertySymbols(value));
  return result;
};
const hide = { enumerable: false };
const show = { enumerable: true };
const ADD = 0;
const KEEP = 1;
const REPLACE = 2;
const set = (target: any, key: Key, value: any) =>
  define(target, key, { value, writable: true, enumerable: true, configurable: true });
const copy = (target: any, source: object) => {
  for (const key of keys(source)) target[key] = (source as any)[key];
};
const check = (value: any) => {
  if (value === null || typeof value !== 'object')
    throw new TypeError('Dependency maps must be non-null objects');
};

const makeModuleImplementation = (options: any = {}) => {
  options = typeof options === 'function' ? { transformInput: options } : options;
  const {
    cache = 'run',
    lazy = true,
    transformInput: input = withModuleName,
    transformOutput: output = (value: any) => value,
  } = options;
  const usesDefaultInput = input === withModuleName;
  let moduleCache: any = Object.create(null);
  const createModule = () => (name: Key, fn: (deps: any) => any) => {
    const register = (target: any, source: object, mode = ADD) => {
      for (const key of keys(source)) {
        if (mode === KEEP && own(target, key)) continue;
        const dep = (source as any)[key];
        if (typeof dep !== 'function' || !own(dep, __deps__)) {
          if (mode === REPLACE) set(target, key, dep);
          else target[key] = dep;
          continue;
        }
        let busy = false;
        let wrote = false;
        const resolve = () => {
          if (busy) throw new Error(`Circular dependency: ${String(key)}`);
          busy = true;
          wrote = false;
          define(target, key, hide);
          let done = false;
          const previousContext = activeContext;
          activeContext = target;
          try {
            const result = dep.call(target);
            done = true;
            if (cache !== 'none' && !wrote) set(target, key, result);
            return result;
          } finally {
            activeContext = previousContext;
            busy = false;
            if ((!done || cache === 'none') &&
              getDescriptor(target, key)?.get === resolve)
              define(target, key, show);
          }
        };
        define(target, key, {
          get: resolve, enumerable: true, configurable: true,
          set(value) { wrote = busy; set(target, key, value); },
        });
      }
    };
    const createCallable = (provided?: object): any => {
      const module = function (this: any, deps?: object) {
        const isRoot = !activeContext || this !== activeContext;
        if (isRoot && deps !== undefined) check(deps);
        if (cache === 'module' && own(moduleCache, name)) return moduleCache[name];
        const context: any = isRoot ? Object.create(null) : this;
        const previousMetadata = activeMetadata;
        const restoreModuleByValue = !isRoot && !provided && usesDefaultInput &&
          !!previousMetadata && context.Module === previousMetadata;
        const savedDescriptors = !isRoot && provided
          ? keys(provided).map((key) => [key, getDescriptor(context, key)] as const)
          : undefined;
        const previousModuleDescriptor = !isRoot && !restoreModuleByValue
          ? getDescriptor(context, 'Module') : undefined;
        let currentMetadata: object | undefined;
        if (!usesDefaultInput) activeMetadata = undefined;
        try {
          if (provided) register(context, provided, isRoot ? ADD : REPLACE);
          if (isRoot && deps) register(context, deps, provided ? KEEP : ADD);
          if (!lazy)
            for (const key of isRoot ? keys(context) : provided ? keys(provided) : [])
              context[key];
          let transformedDeps;
          if (usesDefaultInput) {
            currentMetadata = { name };
            context.Module = currentMetadata;
            transformedDeps = context;
            activeMetadata = currentMetadata;
          } else transformedDeps = input(context, name);
          const result = output(fn(transformedDeps), transformedDeps, isRoot);
          if (cache === 'module') set(moduleCache, name, result);
          return result;
        } finally {
          activeMetadata = previousMetadata;
          if (!isRoot) {
            if (restoreModuleByValue) {
              if (context.Module === currentMetadata)
                context.Module = previousMetadata;
              else set(context, 'Module', previousMetadata);
            } else if (previousModuleDescriptor)
              define(context, 'Module', previousModuleDescriptor);
            else delete context.Module;
            if (savedDescriptors) for (const [key, property] of savedDescriptors) {
              if (property) define(context, key, property);
              else delete context[key];
            }
          }
        }
      };
      module.provide = (partial?: object) => {
        if (partial === undefined) partial = {};
        check(partial);
        const combined = Object.create(null);
        if (provided) copy(combined, provided);
        copy(combined, partial);
        return createCallable(combined);
      };
      Object.defineProperties(module, {
        name: { value: name, configurable: true }, [__deps__]: { value: true },
      });
      return module;
    };
    return createCallable();
  };
  createModule.flushCache = () => (moduleCache = Object.create(null));
  return createModule;
};
export const makeModule = makeModuleImplementation as Make;
