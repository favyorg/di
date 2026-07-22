# @favy/di

[![codecov](https://codecov.io/gh/favyorg/di/branch/main/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di) [![npm version](https://badge.fury.io/js/@favy%2Fdi.svg)](https://badge.fury.io/js/@favy%2Fdi) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@favy/di) ![GitHub](https://img.shields.io/github/license/favyorg/di?style=flat)

A lightweight dependency injection library for TypeScript. Modules are typed functions, dependencies stay explicit, and any implementation can be replaced at the application boundary.

## Features

- Create modules with ordinary functions—no decorators or container setup
- Keep dependency contracts explicit while TypeScript infers module results
- Replace direct or transitive dependencies in tests
- Choose per-run, factory-wide, or disabled caching
- Initialize dependencies lazily by default
- Extend input and output types with higher-kinded types

## Installation

```bash
npm install @favy/di
```

The declarations require TypeScript 5.0 or newer.

## Quick Start

```typescript
import { Module, type Live } from '@favy/di';

const Logger = Module()('Logger', () => ({
  log: (message: string) => console.log(message),
}));
type LoggerLive = Live<typeof Logger>;

const App = Module<LoggerLive>()('App', ({ Logger }) => ({
  start: () => Logger.log('Application started'),
}));

App({ Logger }).start(); // Application started
```

`Live<typeof Logger>` describes both the dependencies required by `Logger` and the value it provides under the `Logger` key. Pass module implementations to the top-level call; @favy/di resolves the graph from that boundary.

Dependency maps passed to module calls and `.provide()` may be any non-null object, including class instances and objects with custom prototypes. The library consumes their own string and symbol keys; inherited properties are ignored.

## Partial Application

```typescript
import { Module } from '@favy/di';

const Calculator = Module<{ x: number; y: number }>()('Calculator', ({ x, y }) => x + y);

const AddFive = Calculator.provide({ x: 5 });
console.log(AddFive({ y: 3 })); // 8
```

## Lazy Initialization

Dependencies are initialized when they are first accessed. Keep the dependency object intact when access needs to remain conditional.

```typescript
import { Module, type Live } from '@favy/di';

const ExpensiveValue = Module()('ExpensiveValue', () => {
  console.log('ExpensiveValue initialized');
  return 42;
});
type ExpensiveValueLive = Live<typeof ExpensiveValue>;

const Consumer = Module<ExpensiveValueLive>()('Consumer', ($) => ({
  read: () => $.ExpensiveValue,
}));

const consumer = Consumer({ ExpensiveValue }); // Nothing logged yet
console.log(consumer.read()); // Initializes ExpensiveValue, then prints 42
```

## Cache Management

```typescript
import { makeModule } from '@favy/di';

const CachedModule = makeModule({ cache: 'module' });
const RandomValue = CachedModule()('RandomValue', () => Math.random());

console.log(RandomValue()); // New value
console.log(RandomValue()); // Same cached value

CachedModule.flushCache();
console.log(RandomValue()); // New value
```

See [Caching](https://di.favy.dev/module/cache/), [Lazy Initialization](https://di.favy.dev/module/lazy/), and the [API Reference](https://di.favy.dev/reference/api/) for details.

## Documentation

Full documentation is available at [di.favy.dev](https://di.favy.dev/).

## Contributing

See the [documentation contributor guide](https://github.com/favyorg/di/blob/main/docs/README.md) for local commands. Bug reports and pull requests are welcome in the [GitHub repository](https://github.com/favyorg/di).

## License

@favy/di is distributed under the MIT license. See the [LICENSE](https://github.com/favyorg/di/blob/main/LICENSE) file.
