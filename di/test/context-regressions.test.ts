import { makeModule, type Live, type ModuleLive } from '../src';

test('prototype defaults cannot override own dependencies in a nested context', () => {
  const Module = makeModule({
    transformInput: <D extends object>(deps: D): D =>
      Object.setPrototypeOf(deps, { x: 99 }),
  });
  const Child = Module<{ x: number }>()('Child', (deps) => {
    const initial = deps.x;
    expect(Object.getOwnPropertyDescriptor(deps, 'x')?.value).toBe(1);
    deps.x = 2;
    return initial;
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => ({
    child: deps.Child,
    x: deps.x,
  }));

  expect(Root({ Child, x: 1 })).toEqual({ child: 1, x: 2 });
});

test('a partial descriptor update preserves the borrowed value and attributes', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.defineProperty(deps, 'x', { enumerable: false });

    expect(deps.x).toBe(3);
    expect(Object.getOwnPropertyDescriptor(deps, 'x')).toEqual({
      value: 3,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    deps.x = 4;
    return deps.x;
  });
  const Root = Module<Live<typeof Child>>()('Root', ({ Child }) => Child);

  expect(Root({ Child, x: 3 })).toBe(4);
});

test('a borrowed data property can become an accessor without losing its flags', () => {
  const Module = makeModule();
  const Child = Module<{ x: number; base: number }>()('Child', (deps) => {
    const get = function (this: { base: number }) {
      return this.base + 1;
    };
    Object.defineProperty(deps, 'x', { get });

    expect(Object.getOwnPropertyDescriptor(deps, 'x')).toEqual({
      get,
      set: undefined,
      enumerable: true,
      configurable: true,
    });
    return deps.x;
  });
  const Root = Module<Live<typeof Child>>()('Root', ({ Child }) => Child);

  expect(Root({ Child, x: 3, base: 8 })).toBe(9);
});

test('a borrowed accessor can become a data property without losing its flags', () => {
  const Module = makeModule({
    transformInput: <D extends object>(deps: D, name: PropertyKey): D => {
      if (name === 'Root')
        Object.defineProperty(deps, 'x', {
          get: () => 7,
          enumerable: true,
          configurable: true,
        });
      return deps;
    },
  });
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.defineProperty(deps, 'x', { value: 9 });

    expect(Object.getOwnPropertyDescriptor(deps, 'x')).toEqual({
      value: 9,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    return deps.x;
  });
  const Root = Module<Live<typeof Child>>()('Root', ({ Child }) => Child);

  expect(Root({ Child, x: 3 })).toBe(9);
});

test('a non-extensible nested context remains enumerable', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.preventExtensions(deps);
    expect(Object.isExtensible(deps)).toBe(false);
    return Object.keys(deps).sort();
  });
  const Root = Module<Live<typeof Child>>()('Root', ({ Child }) => Child);

  expect(Root({ Child, x: 1 })).toEqual(['Module', 'x']);
});

test('preventExtensions preserves live shared values and the lazy provider cache', () => {
  const Module = makeModule();
  let calls = 0;
  const Value = Module()('Value', () => ++calls);
  const Reader = Module<Live<typeof Value> & { x: number } & ModuleLive>()(
    'Reader',
    (deps) => {
      Object.preventExtensions(deps);
      return () => {
        const value = deps.Value;
        expect(Object.keys(deps).sort()).toEqual([
          'Module',
          'Reader',
          'Value',
          'x',
        ]);
        return { x: deps.x, value, name: deps.Module.name };
      };
    }
  );
  const Root = Module<Live<typeof Reader>>()('Root', (deps) => {
    const read = deps.Reader;
    expect(calls).toBe(0);
    deps.x = 2;
    const first = read();
    const shared = deps.Value;
    deps.x = 3;
    return { first, shared, second: read() };
  });

  expect(Root({ Reader, Value, x: 1 })).toEqual({
    first: { x: 2, value: 1, name: 'Reader' },
    shared: 1,
    second: { x: 3, value: 1, name: 'Reader' },
  });
  expect(calls).toBe(1);
});

test('a partial descriptor update keeps a borrowed provider in the shared cache', () => {
  const Module = makeModule();
  let calls = 0;
  const Value = Module()('Value', () => ++calls);
  const Child = Module<Live<typeof Value>>()('Child', (deps) => {
    Object.defineProperty(deps, 'Value', { enumerable: false });
    return [deps.Value, deps.Value];
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => ({
    child: deps.Child,
    value: deps.Value,
  }));

  expect(Root({ Child, Value })).toEqual({ child: [1, 1], value: 1 });
  expect(calls).toBe(1);
});

test('a closed context removes a forwarded property deleted by its parent', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.preventExtensions(deps);
    return () => ({
      value: deps.x,
      present: 'x' in deps,
      canRestore: Reflect.set(deps, 'x', 2),
      keys: Object.keys(deps).sort(),
      descriptor: Object.getOwnPropertyDescriptor(deps, 'x'),
    });
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => {
    const inspect = deps.Child;
    Reflect.deleteProperty(deps, 'x');
    return inspect();
  });

  expect(Root({ Child, x: 1 })).toEqual({
    keys: ['Child', 'Module'],
    descriptor: undefined,
    present: false,
    canRestore: false,
    value: undefined,
  });
});

test.each([false, true])(
  'deleting through a nested context removes its shared binding with closed=%s',
  (closed) => {
    const Module = makeModule();
    const Child = Module<{ x: number }>()('Child', (deps) => deps);
    const Root = Module<Live<typeof Child>>()('Root', (deps) => {
      const child = deps.Child;
      if (closed) Object.preventExtensions(child);

      expect(Reflect.deleteProperty(child, 'x')).toBe(true);
      for (const context of [child, deps]) {
        expect(context.x).toBeUndefined();
        expect('x' in context).toBe(false);
        expect(Reflect.ownKeys(context)).not.toContain('x');
        expect(Object.getOwnPropertyDescriptor(context, 'x')).toBeUndefined();
      }
      expect(Reflect.deleteProperty(child, 'x')).toBe(true);
    });

    Root({ Child, x: 1 });
  }
);

test('deleting a non-configurable shared binding through a nested context fails', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => deps);
  const Root = Module<Live<typeof Child>>()('Root', (deps) => {
    const child = deps.Child;
    Object.defineProperty(child, 'x', { configurable: false });

    expect(Reflect.deleteProperty(child, 'x')).toBe(false);
    for (const context of [child, deps]) {
      expect(context.x).toBe(1);
      expect('x' in context).toBe(true);
      expect(Reflect.ownKeys(context)).toContain('x');
      expect(Object.getOwnPropertyDescriptor(context, 'x')).toEqual({
        value: 1,
        enumerable: true,
        writable: true,
        configurable: false,
      });
    }
  });

  Root({ Child, x: 1 });
});

test('a borrowed property can be made non-configurable and read-only', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.defineProperty(deps, 'x', {
      value: 2,
      configurable: false,
      writable: false,
    });
    expect(Reflect.set(deps, 'x', 3)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(deps, 'x')).toEqual({
      value: 2,
      configurable: false,
      writable: false,
      enumerable: true,
    });
    return deps.x;
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => ({
    child: deps.Child,
    x: deps.x,
  }));

  expect(Root({ Child, x: 1 })).toEqual({ child: 2, x: 2 });
});

test('a pinned borrowed descriptor follows its owner becoming read-only', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.defineProperty(deps, 'x', { configurable: false });
    return () => Object.getOwnPropertyDescriptor(deps, 'x');
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => {
    const inspect = deps.Child;
    Object.defineProperty(deps, 'x', { writable: false });
    return inspect();
  });

  expect(Root({ Child, x: 1 })).toEqual({
    value: 1,
    configurable: false,
    writable: false,
    enumerable: true,
  });
});

test('a retained nested context can be sealed while sharing writable bindings', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => () => {
    Object.seal(deps);
    expect(Object.isSealed(deps)).toBe(true);
    deps.x = 3;
    expect(Object.keys(deps).sort()).toEqual(['Child', 'Module', 'x']);
    return Object.getOwnPropertyDescriptor(deps, 'x');
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => ({
    child: deps.Child(),
    x: deps.x,
  }));

  expect(Root({ Child, x: 1 })).toEqual({
    child: {
      value: 3,
      configurable: false,
      writable: true,
      enumerable: true,
    },
    x: 3,
  });
});

test('new parent properties do not become own properties of a closed context', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.preventExtensions(deps);
    return () => ({
      keys: Object.keys(deps).sort(),
      ownsLater: Object.hasOwn(deps, 'later'),
      descriptor: Object.getOwnPropertyDescriptor(deps, 'later'),
    });
  });
  const Root = Module<Live<typeof Child>>()('Root', (deps) => {
    const inspect = deps.Child;
    Object.defineProperty(deps, 'later', {
      value: 2,
      enumerable: true,
      configurable: true,
    });
    return inspect();
  });

  expect(Root({ Child, x: 1 })).toEqual({
    keys: ['Child', 'Module', 'x'],
    ownsLater: false,
    descriptor: undefined,
  });
});

test('a nested context can call methods from its own prototype', () => {
  const Module = makeModule();
  const prototype = {
    readLocal(this: { x: number }) {
      return this.x;
    },
  };
  const Child = Module<{ x: number }>()('Child', (deps) => {
    Object.setPrototypeOf(deps, prototype);
    expect('readLocal' in deps).toBe(true);
    expect(Object.getPrototypeOf(deps)).toBe(prototype);
    return Reflect.get(deps, 'readLocal').call(deps) as number;
  }).provide({ x: 7 });
  const Root = Module<Live<typeof Child> & { x: number }>()('Root', (deps) => {
    const child = deps.Child;
    expect(Object.getPrototypeOf(deps)).toBeNull();
    expect('readLocal' in deps).toBe(false);
    return { child, x: deps.x };
  });

  expect(Root({ Child, x: 1 })).toEqual({ child: 7, x: 1 });
});

test('borrowed accessors receive the context with the provided bindings', () => {
  const Module = makeModule({
    transformInput: <D extends object>(deps: D, name: PropertyKey): D => {
      if (name === 'Root')
        Object.defineProperty(deps, 'derived', {
          get(this: { x: number }) {
            return this.x * 2;
          },
          set(this: { x: number }, value: number) {
            this.x = value / 2;
          },
          enumerable: true,
          configurable: true,
        });
      return deps;
    },
  });
  const Child = Module<{ x: number; derived: number }>()('Child', (deps) => {
    const initial = deps.derived;
    deps.derived = 30;
    return { initial, x: deps.x, derived: deps.derived };
  }).provide({ x: 10 });
  const Root = Module<Live<typeof Child> & { x: number }>()('Root', (deps) => ({
    child: deps.Child,
    x: deps.x,
  }));

  expect(Root({ Child, x: 1, derived: 0 })).toEqual({
    child: { initial: 20, x: 15, derived: 30 },
    x: 1,
  });
});

test('assigning through a derived object preserves the shared context bindings', () => {
  const Module = makeModule();
  const Child = Module<{ x: number }>()('Child', (deps) => deps);
  const Root = Module<Live<typeof Child>>()('Root', (deps) => {
    const child = deps.Child;
    const derived = Object.create(child) as { x: number };
    derived.x = 2;

    return {
      derived: derived.x,
      ownsX: Object.hasOwn(derived, 'x'),
      child: child.x,
      root: deps.x,
    };
  });

  expect(Root({ Child, x: 1 })).toEqual({
    derived: 2,
    ownsX: true,
    child: 1,
    root: 1,
  });
});

describe('sealed and frozen unresolved providers', () => {
  const closeOperations: [string, (context: object) => object][] = [
    ['seal', Object.seal],
    ['freeze', Object.freeze],
  ];

  describe.each(['run', 'none'] as const)('with cache=%s', (cache) => {
    test.each(closeOperations)(
      '%s preserves provider resolution',
      (_, close) => {
        const Module = makeModule({ cache });
        let calls = 0;
        const Value = Module()('Value', () => ++calls);
        const Reader = Module<Live<typeof Value>>()('Reader', (deps) => () => {
          close(deps);
          return [deps.Value, deps.Value];
        });
        const Root = Module<Live<typeof Reader>>()(
          'Root',
          (deps) => deps.Reader
        );

        const read = Root({ Reader, Value });
        expect(calls).toBe(0);
        expect(read()).toEqual(cache === 'run' ? [1, 1] : [1, 2]);
        expect(calls).toBe(cache === 'run' ? 1 : 2);
      }
    );
  });

  test('a failed provider can retry in a sealed context', () => {
    const Module = makeModule();
    let calls = 0;
    const Value = Module()('Value', () => {
      if (++calls === 1) throw new Error('first attempt');
      return 42;
    });
    const Reader = Module<Live<typeof Value>>()('Reader', (deps) => () => {
      Object.seal(deps);
      expect(() => deps.Value).toThrow('first attempt');
      return deps.Value;
    });
    const Root = Module<Live<typeof Reader>>()('Root', (deps) => deps.Reader);

    const read = Root({ Reader, Value });
    expect(read()).toBe(42);
    expect(calls).toBe(2);
  });

  test.each(closeOperations)(
    '%s preserves explicit assignment with cache=none',
    (_, close) => {
      const Module = makeModule({ cache: 'none' });
      let calls = 0;
      const Value = Module()('Value', () => ++calls);
      const Reader = Module<Live<typeof Value>>()('Reader', (deps) => () => {
        close(deps);
        deps.Value = 42;
        return [deps.Value, deps.Value];
      });
      const Root = Module<Live<typeof Reader>>()('Root', (deps) => deps.Reader);

      const read = Root({ Reader, Value });
      expect(read()).toEqual([42, 42]);
      expect(calls).toBe(0);
    }
  );
});

describe.each(['run', 'none'] as const)(
  'deferred contexts with cache=%s',
  (cache) => {
    test.each([true, false])(
      'preserve provided bindings and names with lazy=%s',
      (lazy) => {
        const Module = makeModule({ cache, lazy });
        const Variant = Module<{ x: string } & ModuleLive>()(
          'Variant',
          (deps) => () => ({ x: deps.x, name: deps.Module.name })
        );
        const Left = Variant.provide({ x: 'left' });
        const Right = Variant.provide({ x: 'right' });
        const Root = Module<
          {
            Left: ReturnType<typeof Left>;
            Right: ReturnType<typeof Right>;
          } & ModuleLive
        >()('Root', (deps) => ({
          left: deps.Left,
          right: deps.Right,
          rootName: () => deps.Module.name,
        }));

        const result = Root({ Left, Right });
        expect(result.right()).toEqual({ x: 'right', name: 'Variant' });
        expect(result.left()).toEqual({ x: 'left', name: 'Variant' });
        expect(result.right()).toEqual({ x: 'right', name: 'Variant' });
        expect(result.rootName()).toBe('Root');
      }
    );
  }
);

test('deep deferred provider contexts do not stack forwarding traps', () => {
  const Module = makeModule();
  const depth = 800;
  const dependencies: Record<string, unknown> = { value: 42 };
  for (let index = 0; index < depth; index++) {
    const name = `Link${index}`;
    const next = `Link${index + 1}`;
    dependencies[name] = Module<Record<string, unknown>>()(name, (deps) =>
      index === depth - 1
        ? () => ({ value: deps['value'], keys: Object.keys(deps).length })
        : () => deps[next]
    );
  }
  const Root = Module<Record<string, unknown>>()(
    'Root',
    (deps) => deps['Link0']
  );
  let result = Root(dependencies);
  for (let index = 0; index < depth; index++)
    result = (result as () => unknown)();

  expect(result).toEqual({ value: 42, keys: depth + 2 });
});

test('deep synchronous provider resolution does not multiply the call stack', () => {
  const Module = makeModule();
  const depth = 800;
  const dependencies: Record<string, unknown> = { value: 42 };
  for (let index = 0; index < depth; index++) {
    const name = `Link${index}`;
    const next = index === depth - 1 ? 'value' : `Link${index + 1}`;
    dependencies[name] = Module<Record<string, unknown>>()(
      name,
      (deps) => deps[next]
    );
  }
  const Root = Module<Record<string, unknown>>()(
    'Root',
    (deps) => deps['Link0']
  );

  expect(Root(dependencies)).toBe(42);
});
