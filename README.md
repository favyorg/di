# @favy/di

[![codecov](https://codecov.io/gh/favyorg/di/branch/main/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di) [![npm version](https://badge.fury.io/js/@favy%2Fdi.svg)](https://badge.fury.io/js/@favy%2Fdi) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@favy/di) ![GitHub](https://img.shields.io/github/license/favyorg/di?style=flat)

Dependency graphs, just typed functions.

@favy/di v3 turns ordinary TypeScript functions into named, composable dependency providers. Dependency objects stay explicit, results stay inferred, and concrete implementations are selected at the composition root—without decorators or container configuration.

## Features

- Build named modules from ordinary functions
- Carry transitive requirements through `Live<T>`
- Replace dependencies at the application boundary
- Bind known values incrementally with `.provide()`
- Resolve lazily and cache within each run by default
- Customize input and output types when a graph needs them

## Installation

```bash
npm install @favy/di
```

Requires TypeScript 5+.

## Quick Start

```typescript
import { Module, type Live } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => new Date(),
}));
type ClockLive = Live<typeof Clock>;

const Greeting = Module<ClockLive>()('Greeting', ({ Clock }) => {
  const hour = Clock.now().getUTCHours();
  return hour < 12 ? 'Good morning!' : 'Good evening!';
});
```

## Mental model

- **`Module`** creates a named callable provider from a typed dependency object and an ordinary function.
- **`Live<T>`** carries a module's transitive requirements plus its result under the module's declared name.
- **The composition root** is the top-level call where the application assembles concrete values and providers.

## Replace at the boundary

```typescript
import { Module, type Live } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => new Date(),
}));
type ClockLive = Live<typeof Clock>;

const Greeting = Module<ClockLive>()('Greeting', ({ Clock }) => {
  const hour = Clock.now().getUTCHours();
  return hour < 12 ? 'Good morning!' : 'Good evening!';
});

console.log(
  Greeting({
    Clock: { now: () => new Date('2025-01-01T09:00:00.000Z') },
  }),
); // "Good morning!"
```

The replacement is a plain value with the same contract as `Clock`; no container mutation or special test API is required.

## Partial application

Use `.provide()` to bind part of a dependency object and get back a module that asks only for the remaining fields.

```typescript
import { Module } from '@favy/di';

const Add = Module<{ left: number; right: number }>()(
  'Add',
  ({ left, right }) => left + right,
);

const AddTen = Add.provide({ right: 10 });
console.log(AddTen({ left: 5 })); // 15
```

## Default lifecycle

| Default | Behavior |
| --- | --- |
| `lazy: true` | A supplied provider runs only when its key is first read. |
| `cache: 'run'` | Its resolved value is reused for the current top-level call, then recomputed in the next run. |

## Documentation

- [Introduction](https://di.favy.dev/guides/introduction/)
- [Testing](https://di.favy.dev/guides/testing/)
- [Caching](https://di.favy.dev/module/cache/)
- [Lazy initialization](https://di.favy.dev/module/lazy/)
- [Partial application](https://di.favy.dev/module/partial/)
- [Input transforms](https://di.favy.dev/module/transform-input/)
- [Output transforms](https://di.favy.dev/module/transform-output/)
- [API reference](https://di.favy.dev/reference/api/)

## Contributing

See the [documentation contributor guide](https://github.com/favyorg/di/blob/main/docs/README.md) for local commands. Bug reports and pull requests are welcome in the [GitHub repository](https://github.com/favyorg/di).

## License

@favy/di is distributed under the MIT license. See the [LICENSE](https://github.com/favyorg/di/blob/main/LICENSE) file.
