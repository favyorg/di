/* eslint-disable require-yield */
import { GenModule, makeGenModule, type TGenModule } from '../src';

test('a run root shares yielded providers across siblings and starts a fresh cache per call', () => {
  const Uncached = makeGenModule({ cache: 'none' });
  let calls = 0;
  const Counter = Uncached()('Counter', function* () {
    return { id: ++calls };
  });
  const Child = GenModule()('Child', function* () {
    return yield* Counter;
  });
  const Main = GenModule()('Main', function* () {
    return [yield* Counter, yield* Child, yield* Counter];
  });

  const first = Main({ Counter, Child });
  expect(first.map((counter) => counter.id)).toEqual([1, 1, 1]);
  expect(first[0]).toBe(first[1]);
  expect(first[1]).toBe(first[2]);
  const second = Main({ Counter, Child });
  expect(second.map((counter) => counter.id)).toEqual([2, 2, 2]);
  expect(second[0]).not.toBe(first[0]);
  expect(calls).toBe(2);
});

test('a none root resolves every yield even when the provider uses run caching', () => {
  const Uncached = makeGenModule({ cache: 'none' });
  let calls = 0;
  const Counter = GenModule()('Counter', function* () {
    return ++calls;
  });
  const Main = Uncached()('Main', function* () {
    return [yield* Counter, yield* Counter];
  });

  expect(Main({ Counter })).toEqual([1, 2]);
  expect(Main({ Counter })).toEqual([3, 4]);
  expect(calls).toBe(4);
});

test('a generator module retains its completed result until its factory cache is flushed', () => {
  const Cached = makeGenModule({ cache: 'module' });
  let calls = 0;
  const Value = Cached<{ value: number }>()('Value', function* ({ value }) {
    calls++;
    return { value };
  });

  const first = Value({ value: 1 });
  expect(Value({ value: 2 })).toBe(first);
  expect(first).toEqual({ value: 1 });
  expect(calls).toBe(1);
  Cached.flushCache();
  expect(Value({ value: 3 })).toEqual({ value: 3 });
  expect(calls).toBe(2);
});

test('same-name generator modules from independent factories keep separate module caches', () => {
  const FirstFactory = makeGenModule({ cache: 'module' });
  const SecondFactory = makeGenModule({ cache: 'module' });
  let firstCalls = 0;
  let secondCalls = 0;
  const First = FirstFactory()('Value', function* () {
    return ++firstCalls;
  });
  const Second = SecondFactory()('Value', function* () {
    return ++secondCalls * 10;
  });

  expect(First()).toBe(1);
  expect(Second()).toBe(10);
  FirstFactory.flushCache();
  expect(First()).toBe(2);
  expect(Second()).toBe(10);
  expect(secondCalls).toBe(1);
});

test('a yielded provider owns its module cache under a none root', () => {
  const Uncached = makeGenModule({ cache: 'none' });
  const Cached = makeGenModule({ cache: 'module' });
  let calls = 0;
  const Counter = Cached()('Counter', function* () {
    return ++calls;
  });
  const Main = Uncached()('Main', function* () {
    return [yield* Counter, yield* Counter];
  });

  expect(Main({ Counter })).toEqual([1, 1]);
  Uncached.flushCache();
  expect(Main({ Counter })).toEqual([1, 1]);
  Cached.flushCache();
  expect(Main({ Counter })).toEqual([2, 2]);
  expect(calls).toBe(2);
});

test('provided generator bindings retain their owner cache policy and stay local to that module', () => {
  const Uncached = makeGenModule({ cache: 'none' });
  let calls = 0;
  const Counter = GenModule()('Counter', function* () {
    return ++calls;
  });
  const Child = Uncached()('Child', function* () {
    return [yield* Counter, yield* Counter];
  }).provide({ Counter });
  const Main = GenModule()('Main', function* () {
    const before = yield* Counter;
    const child = yield* Child;
    const after = yield* Counter;
    return { before, child, after };
  });

  expect(Main({ Counter, Child })).toEqual({
    before: 1,
    child: [2, 3],
    after: 1,
  });
  expect(calls).toBe(3);
});

test('lazy generator roots resolve only the dependencies reached by the selected branch', () => {
  const events: string[] = [];
  const Selected = GenModule()('Selected', function* () {
    events.push('selected');
    return 'selected';
  });
  const Skipped = GenModule()('Skipped', function* () {
    events.push('skipped');
    throw new Error('the skipped branch must stay lazy');
  });
  const Main = GenModule<{ selected: boolean }>()(
    'Main',
    function* ({ selected }) {
      return selected ? yield* Selected : yield* Skipped;
    }
  );

  expect(Main({ selected: true, Selected, Skipped })).toBe('selected');
  expect(events).toEqual(['selected']);
});

test('eager generator roots initialize unused providers before entering the generator', () => {
  const Eager = makeGenModule({ lazy: false });
  const events: string[] = [];
  const Selected = GenModule()('Selected', function* () {
    events.push('selected');
    return 'selected';
  });
  const Skipped = GenModule()('Skipped', function* () {
    events.push('skipped');
    return 'skipped';
  });
  const Main = Eager<{ selected: boolean }>()('Main', function* ({ selected }) {
    events.push('main');
    return selected ? yield* Selected : yield* Skipped;
  });

  expect(Main({ selected: true, Selected, Skipped })).toBe('selected');
  expect(events).toEqual(['selected', 'skipped', 'main']);
});

test('dependency errors are thrown at yield so catch can yield a fallback and finally runs once', () => {
  const failure = new Error('dependency failed');
  const events: string[] = [];
  const Broken = GenModule()('Broken', function* () {
    events.push('broken');
    throw failure;
  });
  const Fallback = GenModule()('Fallback', function* () {
    events.push('fallback');
    return 42;
  });
  const Main = GenModule()('Main', function* () {
    try {
      return yield* Broken;
    } catch (error) {
      expect(error).toBe(failure);
      events.push('catch');
      return yield* Fallback;
    } finally {
      events.push('finally');
    }
  });

  expect(Main({ Broken, Fallback })).toBe(42);
  expect(events).toEqual(['broken', 'catch', 'fallback', 'finally']);
});

test('a failed yielded provider can be retried in the same run without caching the failure', () => {
  let calls = 0;
  const failure = new Error('first attempt failed');
  const Retryable = GenModule()('Retryable', function* () {
    if (++calls === 1) throw failure;
    return 42;
  });
  const Main = GenModule()('Main', function* () {
    try {
      return yield* Retryable;
    } catch (error) {
      expect(error).toBe(failure);
      return [yield* Retryable, yield* Retryable];
    }
  });

  expect(Main({ Retryable })).toEqual([42, 42]);
  expect(calls).toBe(2);
});

test('an uncaught generator error propagates once and leaves the next root usable', () => {
  const failure = new Error('generator failed');
  let calls = 0;
  let finalizations = 0;
  const Worker = GenModule<{ fail: boolean; value: number }>()(
    'Worker',
    function* ({ fail, value }) {
      calls++;
      try {
        if (fail) throw failure;
        return value;
      } finally {
        finalizations++;
      }
    }
  );
  const Main = GenModule()('Main', function* () {
    return yield* Worker;
  });

  expect(() => Main({ Worker, fail: true, value: 1 })).toThrow(failure);
  expect(calls).toBe(1);
  expect(finalizations).toBe(1);
  expect(Main({ Worker, fail: false, value: 2 })).toBe(2);
  expect(calls).toBe(2);
  expect(finalizations).toBe(2);
});

test('a missing yielded dependency errors while an explicitly undefined value is valid', () => {
  let calls = 0;
  const OptionalValue = GenModule()('OptionalValue', function* () {
    calls++;
    return undefined;
  });
  const Main = GenModule()('Main', function* () {
    return yield* OptionalValue;
  });

  // JavaScript callers can omit a dependency that TypeScript requires.
  const callWithoutRequiredValue = Main as unknown as (
    deps: Record<string, never>
  ) => undefined;
  expect(() => callWithoutRequiredValue({})).toThrow(
    'Missing dependency: OptionalValue'
  );
  expect(Main({ OptionalValue: undefined })).toBeUndefined();
  expect(calls).toBe(0);
  expect(Main({ OptionalValue })).toBeUndefined();
  expect(calls).toBe(1);
});

test('yielded circular dependencies fail with a clear error and can recover with a raw binding', () => {
  // The explicit finite contract describes a cycle without recursive inference.
  type Cycle = { A: number; B: number };
  const A: TGenModule<'A', Cycle, number> = GenModule<Cycle>()(
    'A',
    function* () {
      return yield* B;
    }
  );
  const B: TGenModule<'B', Cycle, number> = GenModule<Cycle>()(
    'B',
    function* () {
      return yield* A;
    }
  );

  expect(() => A({ A, B })).toThrow('Circular dependency: B');
  expect(A({ A: 42, B })).toBe(42);
});

test('a root invoked while a yielded provider is running does not replace its DI context', () => {
  const values: string[] = [];
  const Value = GenModule<{ value: string }>()('Value', function* ({ value }) {
    values.push(value);
    return value;
  });
  const Inner = GenModule()('Inner', function* () {
    return yield* Value;
  });
  const Worker = GenModule()('Worker', function* () {
    const inner = Inner({ Value, value: 'inner' });
    const outer = yield* Value;
    return { inner, outer };
  });
  const Main = GenModule()('Main', function* () {
    return { worker: yield* Worker, value: yield* Value };
  });

  expect(Main({ Worker, Value, value: 'outer' })).toEqual({
    worker: { inner: 'inner', outer: 'outer' },
    value: 'outer',
  });
  expect(values).toEqual(['inner', 'outer']);
});

test('a failed reentrant root restores the outer provider context before its next yield', () => {
  const failure = new Error('inner root failed');
  const caught: unknown[] = [];
  const Value = GenModule<{ value: string }>()('Value', function* ({ value }) {
    return value;
  });
  const Inner = GenModule()('Inner', function* () {
    expect(yield* Value).toBe('inner');
    throw failure;
  });
  const Worker = GenModule()('Worker', function* () {
    try {
      Inner({ Value, value: 'inner' });
    } catch (error) {
      caught.push(error);
    }
    return yield* Value;
  });
  const Main = GenModule()('Main', function* () {
    return [yield* Worker, yield* Value];
  });

  expect(Main({ Worker, Value, value: 'outer' })).toEqual(['outer', 'outer']);
  expect(caught).toHaveLength(1);
  expect(caught[0]).toBe(failure);
});

test('finally can yield cleanup before an uncaught dependency error leaves the generator', () => {
  const failure = new Error('dependency failed');
  const events: string[] = [];
  const Broken = GenModule()('Broken', function* () {
    events.push('broken');
    throw failure;
  });
  const Cleanup = GenModule()('Cleanup', function* () {
    events.push('cleanup');
    return 'cleaned';
  });
  const Main = GenModule()('Main', function* () {
    try {
      return yield* Broken;
    } finally {
      events.push(yield* Cleanup);
    }
  });

  expect(() => Main({ Broken, Cleanup })).toThrow(failure);
  expect(events).toEqual(['broken', 'cleanup', 'cleaned']);
});
