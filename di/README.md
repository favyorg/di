# @favy/di

[![codecov](https://codecov.io/gh/favyorg/di/branch/main/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di) [![npm version](https://badge.fury.io/js/@favy%2Fdi.svg)](https://badge.fury.io/js/@favy%2Fdi) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@favy/di) ![GitHub](https://img.shields.io/github/license/favyorg/di?style=flat)

Dependency graphs, just typed functions.

@favy/di v3 turns ordinary TypeScript functions into named, composable dependency providers. Dependency objects stay explicit, results stay inferred, and concrete implementations are selected at the composition root—without decorators or container configuration.

## Features

- Create named modules with ordinary functions, without decorators or container setup
- Carry transitive requirements through `typeof Foo.Live` while TypeScript infers module results
- Separate service contracts with `Tag` and infer dependencies from `yield*` in `GenModule` callbacks
- Replace direct or transitive dependencies at the application boundary
- Bind known values incrementally with `.provide()`
- Choose per-run, factory-wide, or disabled caching
- Initialize dependencies lazily by default
- Extend input and output types with higher-kinded types

## Installation

```bash
npm install @favy/di
```

Requires TypeScript 5+.

## Quick Start

```typescript
import { Module } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => new Date('2026-01-01T09:00:00.000Z'),
}));
type ClockLive = typeof Clock.Live;

const Greeting = Module<ClockLive>()('Greeting', ({ Clock }) =>
  (name: string) => `Hello, ${name}! It is ${Clock.now().toISOString()}.`,
);
type GreetingLive = typeof Greeting.Live;

const greet = Greeting({ Clock });
console.log(greet('Ada')); // Hello, Ada! It is 2026-01-01T09:00:00.000Z.
```

## Mental model

- `Module<Deps>()(name, factory)` creates a named callable with explicit dependency types and an inferred result.
- `typeof Clock.Live` combines the dependencies required by `Clock` with the value it provides under the `Clock` key. Declare the alias immediately below the module and compose these types to carry transitive requirements through the graph. `.Live` is a type-only marker: use it in a TypeScript type query; reading `Clock.Live` at runtime throws. The exported `Live<typeof Clock>` helper remains equivalent.
- The **composition root** is the top-level call, here `Greeting({ Clock })`. Supply module implementations and dependency values there; @favy/di resolves the graph from that boundary.
- `Tag<Service>()('Key')` declares an iterable service contract. `GenModule<Deps>()(tag, function* (deps) { ... })` creates a checked implementation. Consumers use `yield* tag` and require only the service; fully bind the implementation's dependencies with `.provide()` before wiring it at the composition root.
- `GenModule()('Key', function* () { ... })` also supports named modules. Yielding a concrete module carries its transitive requirements. Synchronous generators can return services with async methods; ordinary `Module` callables remain non-iterable.

## Replace a Dependency at the Boundary

Supply a matching value to replace a module implementation. This complete example fixes the clock for a test without changing `Greeting`:

```typescript
import { Module } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => new Date('2026-01-01T09:00:00.000Z'),
}));
type ClockLive = typeof Clock.Live;

const Greeting = Module<ClockLive>()('Greeting', ({ Clock }) =>
  (name: string) => `Hello, ${name}! It is ${Clock.now().toISOString()}.`,
);
type GreetingLive = typeof Greeting.Live;

const greet = Greeting({
  Clock: { now: () => new Date('2026-06-01T12:00:00.000Z') },
});
console.log(greet('Ada')); // Hello, Ada! It is 2026-06-01T12:00:00.000Z.
```

See [Testing](https://di.favy.dev/guides/testing/) for direct and transitive dependency replacement.

## Partial Application

```typescript
import { Module } from '@favy/di';

const Add = Module<{ left: number; right: number }>()(
  'Add',
  ({ left, right }) => left + right,
);
type AddLive = typeof Add.Live;

const AddTen = Add.provide({ left: 10 });
type AddTenLive = typeof AddTen.Live;
console.log(AddTen({ right: 5 })); // 15
```

`.provide()` returns a new module whose call signature requires only the remaining dependencies. The original module is unchanged. See [Partial Application](https://di.favy.dev/module/partial/).

## Default Lifecycle

| Default | Behavior |
| --- | --- |
| `lazy: true` | A supplied provider runs only when its key is first read. |
| `cache: 'run'` | Its resolved value is reused for the current top-level call; if its key is read in a later run, the provider resolves again. |

Keep the dependency object intact when access needs to remain conditional; destructuring reads the selected keys immediately. Use `makeModule` to configure eager resolution, factory-wide caching, or disabled caching. See [Lazy Initialization](https://di.favy.dev/module/lazy/) and [Caching](https://di.favy.dev/module/cache/).

## Documentation

- [Playground](https://di.favy.dev/playground/) includes multi-file React, browser HTTP-handler, and generator projects with an editor, file tree, and live preview. [Basic snippets](https://di.favy.dev/playground/basics/) cover the core API.
- [Introduction](https://di.favy.dev/guides/introduction/) and [Module](https://di.favy.dev/module/module/) explain the core model.
- [Testing](https://di.favy.dev/guides/testing/) and [Best Practices](https://di.favy.dev/guides/best-practices/) cover application boundaries and lifecycle choices.
- [Transform Input](https://di.favy.dev/module/transform-input/) and [Transform Output](https://di.favy.dev/module/transform-output/) cover custom factories.
- [Generator modules](https://di.favy.dev/module/generator/) shows service tags, separate implementations, `yield*`, and async methods in a runnable example.
- [HKT support](https://di.favy.dev/reference/api/#hkt) describes advanced type transformations.
- [API Reference](https://di.favy.dev/reference/api/) documents exports and signatures.

## Contributing

See the [documentation contributor guide](https://github.com/favyorg/di/blob/main/docs/README.md) for local commands. Bug reports and pull requests are welcome in the [GitHub repository](https://github.com/favyorg/di).

## License

@favy/di is distributed under the MIT license. See the [LICENSE](https://github.com/favyorg/di/blob/main/LICENSE) file.
