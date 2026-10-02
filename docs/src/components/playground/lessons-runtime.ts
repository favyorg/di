import tagMessages from '../../examples/projects/tags/messages.ts?raw';
import tagGreeting from '../../examples/projects/tags/greeting.ts?raw';
import tagApp from '../../examples/projects/tags/app.ts?raw';
import generatorMessages from '../../examples/projects/generators/messages.ts?raw';
import generatorGreeting from '../../examples/projects/generators/greeting.ts?raw';
import generatorApp from '../../examples/projects/generators/app.ts?raw';
import implementationMessages from '../../examples/projects/tag-implementation/messages.ts?raw';
import implementationGreeting from '../../examples/projects/tag-implementation/greeting.ts?raw';
import implementationApp from '../../examples/projects/tag-implementation/app.ts?raw';
import lazyApp from '../../examples/projects/lazy/app.ts?raw';
import runCacheApp from '../../examples/projects/run-cache/app.ts?raw';
import moduleCacheApp from '../../examples/projects/module-cache/app.ts?raw';
import mixedFactoriesApp from '../../examples/projects/mixed-factories/app.ts?raw';
import { lessonSource, type PlaygroundProject } from './project-types';

const greetingSyntax = [
  { id: 'tags', label: 'Module' },
  { id: 'generators', label: 'GenModule' },
] as const;

export const runtimeLessons: readonly PlaygroundProject[] = [
  {
    id: 'tags',
    comparison: greetingSyntax,
    title: 'Declare a service contract',
    description:
      'Tag names the Messages service and describes its value. Greeting uses that contract through MessagesLive; app.ts supplies a ready value.',
    exercise: 'In app.ts, change "Hello" to "Hi". Greeting needs no changes.',
    concept: 'Tag',
    section: 'Generators',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/generator/#explicit-inputs-and-live',
    note: 'A tag declares a key and a contract. It does not register an implementation.',
    entry: '/app.ts',
    activeFile: '/messages.ts',
    files: {
      '/messages.ts': lessonSource(tagMessages),
      '/greeting.ts': lessonSource(tagGreeting),
      '/app.ts': lessonSource(tagApp),
    },
  },
  {
    id: 'generators',
    comparison: greetingSyntax,
    title: 'Request a service with yield*',
    description:
      'Keep the same tag and root value. GenModule infers the Messages requirement from yield*; the generator returns the greeting.',
    exercise:
      'In greeting.ts, change Alex to your name. Compare its dependencies with the previous lesson.',
    concept: 'GenModule + yield*',
    section: 'Generators',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/generator/#what-yield-does',
    note: 'Use a synchronous function*. Async generators are unsupported; services can expose async methods.',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: {
      '/greeting.ts': lessonSource(generatorGreeting),
      '/messages.ts': lessonSource(generatorMessages),
      '/app.ts': lessonSource(generatorApp),
    },
  },
  {
    id: 'tag-implementation',
    title: 'Provide a tag implementation',
    description:
      'DefaultMessages implements the Messages tag. Its private prefix input is bound in app.ts before Greeting receives the provider.',
    exercise:
      'In app.ts, set prefix to "Hi". Then supply { hello: "Welcome" } instead of ReadyMessages.',
    concept: 'Tag implementation + provide',
    section: 'Generators',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/generator/#bind-dependencies-with-provide',
    note: 'Greeting requires only Messages. Fully bind the implementation inputs before supplying it under that key.',
    entry: '/app.ts',
    activeFile: '/messages.ts',
    files: {
      '/messages.ts': lessonSource(implementationMessages),
      '/greeting.ts': lessonSource(implementationGreeting),
      '/app.ts': lessonSource(implementationApp),
    },
  },
  {
    id: 'lazy',
    title: 'Resolve only what you read',
    description:
      'makeModule creates a configurable factory. With lazy: true, the unused Counter provider never starts.',
    exercise:
      'Set enabled to true and run. Restore false, then change lazy to false: Counter starts even though the branch ignores it.',
    concept: 'Lazy and eager providers',
    section: 'Lifecycle',
    expectedOutput: 'unused\n0',
    docs: '/module/lazy/',
    note: 'Destructuring Counter in the callback parameter would read it immediately. Keep the access inside the conditional branch.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: { '/app.ts': lessonSource(lazyApp) },
  },
  {
    id: 'run-cache',
    title: 'Reuse a value within one run',
    description:
      'Each ReadTwice call starts a fresh run. cache: "run" reuses Counter for both reads inside that call.',
    exercise:
      'Change cache to "none". The output becomes 1, 2 and 3, 4 because every field read resolves Counter again.',
    concept: 'Run cache and no cache',
    section: 'Lifecycle',
    expectedOutput: '1, 1\n2, 2',
    docs: '/module/cache/',
    note: 'The defaults are cache: "run" and lazy: true. Cache controls reuse; lazy controls whether an unused provider starts.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: { '/app.ts': lessonSource(runCacheApp) },
  },
  {
    id: 'module-cache',
    title: 'Keep a value between runs',
    description:
      'cache: "module" keeps Counter in the factory cache across calls. flushCache clears that factory so the next call computes a new value.',
    exercise:
      'Remove the flushCache call and run. All three calls now return 1.',
    concept: 'Factory cache + flushCache',
    section: 'Lifecycle',
    expectedOutput: '1\n1\n2',
    docs: '/module/cache/#cache-module',
    note: 'This cache uses declared module names as keys. Use unique names within a factory; flushCache clears all its entries.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: { '/app.ts': lessonSource(moduleCacheApp) },
  },
  {
    id: 'mixed-factories',
    title: 'Compose module factories',
    description:
      'Ordinary and generator modules share the same root wiring. Here a small chain uses Module, GenModule, makeModule, and makeGenModule together.',
    exercise:
      'Replace Word in the root call with Word: "Hi". Every factory in the chain receives the replacement.',
    concept: 'Factory interoperability',
    section: 'Lifecycle',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/generator/#factories-caching-and-interoperability',
    note: 'yield* Phrase carries its Word requirement, unlike yielding a tag. Root wiring still supplies Phrase. Ordinary Module callables are not iterable.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: { '/app.ts': lessonSource(mixedFactoriesApp) },
  },
];
