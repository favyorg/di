# @favy/di

[![codecov](https://codecov.io/gh/favyorg/di/branch/master/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di) [![npm version](https://badge.fury.io/js/@favy%2Fdi.svg)](https://badge.fury.io/js/@favy%2Fdi) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@favy/di) ![GitHub](https://img.shields.io/github/license/favyorg/di?style=flat)

A lightweight and powerful dependency injection library for TypeScript.

## Features

- 🚀 Create modules as easily as functions
- 🔧 Easily replace any dependency at any level
- 🌟 Simple integration into any project
- 💪 Full TypeScript support with type inference
- 🧩 High extensibility and support for Higher Kinded Types
- 🎯 Caching and lazy initialization

## Why @favy/di?

Unlike many other solutions, @favy/di offers:

- **Minimal syntax**: No need for decorators or complex configurations.
- **Easy integration**: A module is just a function, so it can be integrated anywhere.
- **Performance**: Minimal runtime overhead.
- **Flexibility**: Easily adapts to different programming styles and patterns.

## Installation

```bash
npm install @favy/di
```

## Quick Start

```typescript
import { Module } from '@favy/di';

const SimpleModule = Module()('SimpleModule', () => 'Hello, DI!');
console.log(SimpleModule()); // Output: Hello, DI!

// Simple module combination
const ModuleA = Module()('ModuleA', () => 10);
const ModuleB = Module()('ModuleB', () => 5);
const CombinedModule = Module()('CombinedModule', ($) => $.ModuleA + $.ModuleB);
console.log(CombinedModule({ ModuleA, ModuleB })); // Output: 15
```

## Advanced Usage

### Partial Application with .provide()

```typescript
const CalculatorModule = Module<{ x: number, y: number }>()('Calculator', ({ x, y }) => x + y);
const PartialCalculator = CalculatorModule.provide({ x: 5 });
console.log(PartialCalculator({ y: 3 })); // Output: 8
```

### Lazy Initialization

```typescript
const LazyModule = Module({ lazy: true })('LazyModule', () => {
  console.log('LazyModule initialized');
  return 42;
});

const Consumer = Module()('Consumer', ($) => {
  setTimeout(() => $.LazyModule, 1000);
});

Consumer({ LazyModule }); 
// Prints "LazyModule initialized" after 1 second
```

### Cache Management

```typescript
const CachedModule = Module({ cache: 'module' })('CachedModule', () => Math.random());
console.log(CachedModule()); // Random number
console.log(CachedModule()); // Same number

Module.flushCache(); // Clear cache
console.log(CachedModule()); // New random number
```

## Documentation

For more detailed information about the library's capabilities and usage examples, please refer to our [full documentation](https://github.com/favy/di/docs).

## Contributing

We welcome community contributions! If you have suggestions for improvements or have found a bug, please create an issue or submit a pull request.

## License

@favy/di is distributed under the MIT license. See the [LICENSE](LICENSE) file for more information.
