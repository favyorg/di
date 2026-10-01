/* eslint-disable require-yield -- dependency-free generators are valid modules */
import { GenModule, makeGenModule, makeModule, Module } from '../src';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Shape<T> = { [K in keyof T]: T[K] };
const expectType = <Actual, Expected>(equal: Equal<Actual, Expected>) => {
  expect(equal).toBe(true);
};

test('a generator without yields preserves its literal result and needs no arguments', () => {
  const Answer = GenModule()('Answer', function* () {
    return 42 as const;
  });
  type AnswerLive = typeof Answer.Live;

  expectType<IsAny<typeof Answer>, false>(true);
  expectType<typeof Answer.name, 'Answer'>(true);
  expectType<Parameters<typeof Answer>, []>(true);
  expectType<ReturnType<typeof Answer>, 42>(true);
  expectType<AnswerLive, { Answer: 42 }>(true);
  expect(Answer()).toBe(42);
  expect(Answer.provide()()).toBe(42);
  expect(() => Answer.Live).toThrow('Live is type-only');
});

test('combines explicit dependencies with every yielded transitive requirement', () => {
  const Config = GenModule<{ endpoint: string }>()(
    'Config',
    function* ({ endpoint }) {
      return endpoint;
    }
  );
  const User = GenModule()('User', function* () {
    const endpoint = yield* Config;
    return { name: `user@${endpoint}` };
  });
  const Orders = GenModule<{ limit: number }>()(
    'Orders',
    function* ({ limit }) {
      const endpoint = yield* Config;
      return { endpoint, count: limit };
    }
  );
  const Main = GenModule<{ label: string }>()('Main', function* ({ label }) {
    const user = yield* User;
    const orders = yield* Orders;
    expectType<typeof user, { name: string }>(true);
    expectType<typeof orders, { endpoint: string; count: number }>(true);
    return `${label}:${user.name}:${orders.count}`;
  });
  type MainLive = typeof Main.Live;

  expectType<IsAny<MainLive>, false>(true);
  expectType<
    Shape<MainLive>,
    {
      endpoint: string;
      Config: string;
      User: { name: string };
      limit: number;
      Orders: { endpoint: string; count: number };
      label: string;
      Main: string;
    }
  >(true);
  expect(
    Main({ endpoint: 'memory', limit: 2, label: 'ready', Config, User, Orders })
  ).toBe('ready:user@memory:2');

  const verifyDependencies = () => {
    // @ts-expect-error The Config module is required through User and Orders.
    Main({ endpoint: 'memory', limit: 2, label: 'ready', User, Orders });
    // @ts-expect-error The transitive raw endpoint remains required.
    Main({ limit: 2, label: 'ready', Config, User, Orders });
    // @ts-expect-error Explicit callback dependencies remain required.
    Main({ endpoint: 'memory', limit: 2, Config, User, Orders });
    Main({
      endpoint: 'memory',
      // @ts-expect-error Inference preserves each transitive dependency's value type.
      limit: 'wrong',
      label: 'ready',
      Config,
      User,
      Orders,
    });
  };
  void verifyDependencies;
});

test('chained provide removes bound requirements and preserves yieldable providers', () => {
  const Service = GenModule<{ prefix: string; count: number }>()(
    'Service',
    function* ({ prefix, count }) {
      return prefix.repeat(count);
    }
  );
  const Root = GenModule<{ suffix: string }>()('Root', function* ({ suffix }) {
    return (yield* Service) + suffix;
  });
  const WithService = Root.provide({ Service });
  const WithConfig = WithService.provide({ prefix: 'a', suffix: '!' });
  type WithConfigLive = typeof WithConfig.Live;
  const Ready = WithConfig.provide({ count: 2 });
  type ReadyLive = typeof Ready.Live;
  const Outer = GenModule()('Outer', function* () {
    return yield* Ready;
  });
  type OuterLive = typeof Outer.Live;

  expectType<Shape<WithConfigLive>, { count: number; Root: string }>(true);
  expectType<ReadyLive, { Root: string }>(true);
  expectType<Parameters<typeof Ready>, []>(true);
  expectType<Shape<OuterLive>, { Root: string; Outer: string }>(true);
  expect(WithConfig({ count: 3 })).toBe('aaa!');
  expect(Ready()).toBe('aa!');
  expect(Outer({ Root: Ready })).toBe('aa!');
  expect(Outer.provide({ Root: Ready })()).toBe('aa!');

  const verifyProvidedTypes = () => {
    // @ts-expect-error The unbound count is still required.
    WithConfig();
    // @ts-expect-error Providing a wrong value does not erase its dependency type.
    WithConfig.provide({ count: 'wrong' });
    // @ts-expect-error Bound keys cannot be supplied again in the typed API.
    WithConfig.provide({ prefix: 'b' });
    // @ts-expect-error Unknown keys are rejected for generator modules too.
    Root.provide({ missing: 1 });
    // @ts-expect-error Yielding Ready still requires an implementation under Root.
    Outer();
  };
  void verifyProvidedTypes;
});

test('partial modules stay independent and their bindings override the root map', () => {
  const Value = GenModule<{ text: string }>()('Value', function* ({ text }) {
    return text;
  });
  const Left = Value.provide({ text: 'left' });
  const Right = Value.provide({ text: 'right' });
  const Root = GenModule()('Root', function* () {
    return yield* Value;
  });

  expect(Root({ Value: Left, text: 'root' })).toBe('left');
  expect(Root({ Value: Right, text: 'root' })).toBe('right');
  expect(Root({ Value, text: 'root' })).toBe('root');
  expect(Left).not.toBe(Right);
  expect(Left).not.toBe(Value);
});

test('iteration is opt-in and produces a request without executing the module', () => {
  let calls = 0;
  const Yieldable = GenModule()('Yieldable', function* () {
    calls += 1;
    return 42;
  });
  const Ordinary = Module()('Ordinary', () => 42);
  const Custom = makeModule()()('Custom', () => 42);

  for (const module of [
    Ordinary,
    Ordinary.provide(),
    Custom,
    Custom.provide(),
  ]) {
    expect(Symbol.iterator in module).toBe(false);
  }
  for (const module of [Yieldable, Yieldable.provide()]) {
    expect(
      Object.getOwnPropertyDescriptor(module, Symbol.iterator)?.enumerable
    ).toBe(false);
    const iterator = module[Symbol.iterator]();
    expect(iterator.next()).toEqual({ done: false, value: module });
    expect(iterator.next(99)).toEqual({ done: true, value: 99 });
  }
  expect(calls).toBe(0);
  expect(Yieldable()).toBe(42);
  expect(calls).toBe(1);
});

test('mixes generator factories and ordinary providers without losing their requirements', () => {
  const OtherFactory = makeGenModule();
  const Endpoint = OtherFactory<{ url: string }>()(
    'Endpoint',
    function* ({ url }) {
      return url;
    }
  );
  const Service = GenModule()('Service', function* () {
    return `service:${yield* Endpoint}`;
  });
  type ServiceLive = typeof Service.Live;
  const OrdinaryFactory = makeModule({ cache: 'none' });
  const Replacement = OrdinaryFactory<{ url: string }>()(
    'Endpoint',
    ({ url }) => `replacement:${url}`
  );
  const Root = Module<ServiceLive>()('Root', ({ Service }) => Service);

  expect(Root({ Service, Endpoint, url: 'memory' })).toBe('service:memory');
  expect(Root({ Service, Endpoint: Replacement, url: 'memory' })).toBe(
    'service:replacement:memory'
  );
  expect(Service({ Endpoint: 'raw', url: 'unused' })).toBe('service:raw');

  const NeedsToken = OrdinaryFactory<{ token: string }>()(
    'Endpoint',
    ({ token }) => token
  );
  const verifyProviderRequirements = () => {
    // @ts-expect-error A replacement may not require a dependency absent from the context.
    Root({ Service, Endpoint: NeedsToken, url: 'memory' });
  };
  void verifyProviderRequirements;
});

test('symbol and numeric module names remain exact dependency keys', () => {
  const key = Symbol('service');
  const SymbolService = GenModule()(key, function* () {
    return 'symbol' as const;
  });
  const NumericService = GenModule()(7, function* () {
    return 7 as const;
  });
  const Main = GenModule()('Main', function* () {
    return [yield* SymbolService, yield* NumericService] as const;
  });
  type MainLive = typeof Main.Live;

  expectType<typeof SymbolService.name, typeof key>(true);
  expectType<typeof NumericService.name, 7>(true);
  expectType<ReturnType<typeof Main>, readonly ['symbol', 7]>(true);
  expectType<
    Shape<MainLive>,
    {
      [key]: 'symbol';
      7: 7;
      Main: readonly ['symbol', 7];
    }
  >(true);
  expect(Main({ [key]: SymbolService, 7: NumericService })).toEqual([
    'symbol',
    7,
  ]);
});

test('function-valued replacements remain raw values until the consumer calls them', () => {
  const Callback = GenModule()('Callback', function* () {
    return (): string => 'original';
  });
  const Main = GenModule()('Main', function* () {
    return yield* Callback;
  });
  const replacement = jest.fn(() => 'replacement');

  const callback = Main({ Callback: replacement });
  expectType<typeof callback, () => string>(true);
  expect(callback).toBe(replacement);
  expect(replacement).not.toHaveBeenCalled();
  expect(callback()).toBe('replacement');
  expect(replacement).toHaveBeenCalledTimes(1);
});

test('async service methods and promise results keep their types and per-call dependencies', async () => {
  const Service = GenModule<{ load: () => Promise<string> }>()(
    'Service',
    function* ({ load }) {
      return { Load: async () => load() };
    }
  );
  const Main = GenModule()('Main', function* () {
    const service = yield* Service;
    expectType<typeof service.Load, () => Promise<string>>(true);
    return service.Load();
  });
  expectType<ReturnType<typeof Main>, Promise<string>>(true);

  const first = Main({ Service, load: async () => 'first' });
  const second = Main({ Service, load: async () => 'second' });
  await expect(Promise.all([first, second])).resolves.toEqual([
    'first',
    'second',
  ]);
  const error = new Error('load failed');
  await expect(
    Main({
      Service,
      load: async () => {
        throw error;
      },
    })
  ).rejects.toBe(error);
});

test('unsupported callbacks and yields are rejected by TypeScript', () => {
  const Ordinary = Module()('Ordinary', () => 1);
  const verifyInvalidDefinitions = () => {
    // @ts-expect-error Ordinary values are not synchronous generators.
    GenModule()('Value', () => 1);
    // @ts-expect-error An async callback returns a promise, not a generator.
    GenModule()('Async', async () => 1);
    // @ts-expect-error Async generators are not accepted by the synchronous runner.
    GenModule()('AsyncGenerator', async function* () {
      return 1;
    });
    // @ts-expect-error A numeric yield is not a module request.
    GenModule()('NumberYield', function* () {
      yield 1;
    });
    // @ts-expect-error Yielded promises are not module requests.
    GenModule()('PromiseYield', function* () {
      yield Promise.resolve(1);
    });
    // @ts-expect-error A name without the module brand is not a request.
    GenModule()('FakeRequest', function* () {
      yield { name: 'Ordinary' };
    });
    // @ts-expect-error Ordinary modules cannot bypass the iterable opt-in with plain yield.
    GenModule()('PlainYield', function* () {
      yield Ordinary;
    });
    GenModule()('DelegatedYield', function* () {
      // @ts-expect-error An ordinary module has no iterator protocol.
      yield* Ordinary;
    });
  };
  void verifyInvalidDefinitions;
  expect(Ordinary()).toBe(1);
});

test('nested generators preserve their own metadata without adding a caller requirement', () => {
  const Child = GenModule()('Child', function* ({ Module }) {
    return Module.name;
  });
  const Root = GenModule()('Root', function* ({ Module }) {
    const before = Module.name;
    const child = yield* Child;
    return { before, child, after: Module.name };
  });
  type RootLive = typeof Root.Live;

  expectType<keyof RootLive, 'Root' | 'Child'>(true);
  expect(Root({ Child })).toEqual({
    before: 'Root',
    child: 'Child',
    after: 'Root',
  });
});

describe('invalid inputs from JavaScript callers', () => {
  // Bypass the public type contract only to exercise runtime validation.
  const createUnchecked = GenModule() as unknown as (
    name: string,
    callback: () => unknown
  ) => () => unknown;

  test.each([
    { name: 'null', callback: () => null },
    { name: 'number', callback: () => 42 },
    { name: 'promise', callback: async () => 42 },
    {
      name: 'async generator',
      callback: async function* () {
        return 42;
      },
    },
  ])('rejects a callback returning $name', ({ callback }) => {
    const Invalid = createUnchecked('Invalid', callback);
    expect(Invalid).toThrow(
      'GenModule callbacks must return synchronous generators'
    );
  });

  test.each([
    { name: 'null', value: null },
    { name: 'number', value: 42 },
    { name: 'promise', value: Promise.resolve(42) },
    { name: 'name-only object', value: { name: 'Fake' } },
    { name: 'ordinary module', value: Module()('Ordinary', () => 42) },
  ])('rejects a yielded $name and runs generator cleanup', ({ value }) => {
    let cleaned = 0;
    const Invalid = createUnchecked('Invalid', function* () {
      try {
        yield value;
      } finally {
        cleaned += 1;
      }
    });
    expect(Invalid).toThrow(
      'GenModule expects dependencies yielded with yield*'
    );
    expect(cleaned).toBe(1);
  });
});
