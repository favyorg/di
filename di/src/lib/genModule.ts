import {
  makeModule,
  type Live,
  type ModuleRequest,
  type TGenModule,
} from './makeModule';
import type { HKT } from './hkt';

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

// Decorate the callable itself so its provider brand and receiver stay intact.
const iterableModules = new WeakSet<object>();
type Callable = { provide(deps?: object): Callable };
const decorate = <M extends Callable>(module: M): M => {
  const provide = module.provide;
  module.provide = (deps?: object) => decorate(provide(deps));
  Object.defineProperty(module, Symbol.iterator, {
    value: function* (): Generator<M, unknown, unknown> {
      return yield module;
    },
  });
  iterableModules.add(module);
  return module;
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
      if (!iterableModules.has(request)) {
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
  const factory = (() => {
    const create = base();
    return (name: PropertyKey, fn: Parameters<typeof create>[1]) =>
      decorate(create(name, fn));
  }) as typeof base;
  factory.flushCache = base.flushCache;
  return factory;
};

/** Infers module dependencies from yield* and returns the generator's result. */
export const GenModule = makeGenModule();
