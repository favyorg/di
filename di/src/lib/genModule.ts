import {
  makeModule,
  type Live,
  type ModuleRequest,
  type TGenModule,
} from './makeModule';
import type { HKT } from './hkt';
import type { ModuleLive } from './module';

/** A service contract and context key, independent of its implementation. */
export interface TTag<N extends PropertyKey, R> extends ModuleRequest<N, object, R> {
  readonly Live: { [K in N]: R };
  [Symbol.iterator](): Generator<ModuleRequest<N, object, R>, R, unknown>;
}

type UnionToIntersection<U> = [U] extends [never]
  ? object
  : (U extends unknown ? (value: U) => void : never) extends (
      value: infer I
    ) => void
  ? I
  : never;

type GeneratorModule<N extends PropertyKey, D, G> = G extends Generator<
  infer Y,
  infer R,
  unknown
>
  ? TGenModule<N, D & UnionToIntersection<Live<Y>>, R>
  : never;

interface GeneratorHKT extends HKT {
  readonly type: GeneratorModule<this['_NAME'], this['_DEPS'], this['_RESULT']>;
}

const iterableRequests = new WeakSet<object>();
const tags = new WeakSet<object>();
const iterable = <T extends object>(request: T): T => {
  Object.defineProperty(request, Symbol.iterator, {
    value: function* (): Generator<T, unknown, unknown> {
      return yield request;
    },
  });
  iterableRequests.add(request);
  return request;
};

/** Declares a yieldable service contract without installing a provider. */
export const Tag = <R>() => <const N extends PropertyKey>(
  name: N extends 'Module' ? never : N
): TTag<N, R> => {
  if (name === 'Module') {
    throw new TypeError('The Module key is reserved for module metadata');
  }
  const tag = iterable(
    Object.defineProperties({}, {
      name: { value: name, enumerable: true },
      Live: {
        get() {
          throw new TypeError('Live is type-only; use typeof Tag.Live');
        },
      },
    })
  );
  tags.add(tag);
  return Object.freeze(tag) as TTag<N, R>;
};

// Decorate the callable itself so its provider brand and receiver stay intact.
type Callable = { provide(deps?: object): Callable };
const decorate = <M extends Callable>(module: M): M => {
  const provide = module.provide;
  module.provide = (deps?: object) => decorate(provide(deps));
  return iterable(module);
};

const run = (
  generator: Generator<ModuleRequest, unknown, unknown>,
  deps: object
) => {
  if (
    !generator ||
    typeof generator.next !== 'function' ||
    typeof generator[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError(
      'GenModule callbacks must return synchronous generators'
    );
  }
  let step = generator.next();
  while (!step.done) {
    let value: unknown;
    try {
      const request = step.value;
      if (!iterableRequests.has(request)) {
        throw new TypeError(
          'GenModule expects dependencies yielded with yield*'
        );
      }
      if (!Object.hasOwn(deps, request.name)) {
        throw new Error(`Missing dependency: ${String(request.name)}`);
      }
      value = Reflect.get(deps, request.name);
    } catch (error) {
      // Inject resolution failures at yield* so generator catch/finally runs.
      step = generator.throw(error);
      continue;
    }
    step = generator.next(value);
  }
  return step.value;
};

/** Creates an independent factory for synchronous generator-based DI. */
export const makeGenModule = (
  options: { cache?: 'run' | 'module' | 'none'; lazy?: boolean } = {}
) => {
  const base = makeModule({
    ...options,
    transformOutput: (
      generator: Generator<ModuleRequest, unknown, unknown>,
      deps
    ) => run(generator, deps) as GeneratorHKT,
  });
  const factory = <D extends object = ModuleLive>() => {
    const create = base<D>();
    const createGenerator = (
      key: PropertyKey | TTag<PropertyKey, unknown>,
      fn: Parameters<typeof create>[1]
    ) => {
      if (typeof key === 'object' && key !== null && !tags.has(key)) {
        throw new TypeError('GenModule expects a module name or a Tag');
      }
      const name = typeof key === 'object' ? key.name : key;
      return decorate(create(name, fn));
    };
    return createGenerator as typeof create & {
      <
        const T extends TTag<PropertyKey, unknown>,
        const F extends (deps: D) => Generator<
          ModuleRequest,
          T['Live'][T['name']],
          unknown
        >
      >(
        tag: T,
        fn: F
      ): GeneratorModule<
        T['name'],
        D extends unknown ? Omit<D, 'Module'> : never,
        ReturnType<F>
      >;
    };
  };
  factory.flushCache = base.flushCache;
  return factory;
};

/** Infers module dependencies from yield* and returns the generator's result. */
export const GenModule = makeGenModule();
