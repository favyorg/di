export type PlaygroundExampleId =
  | 'basic'
  | 'composition'
  | 'replace'
  | 'partial'
  | 'lazy-cache'
  | 'hkt';

export type PlaygroundExample = Readonly<{
  id: PlaygroundExampleId;
  title: string;
  description: string;
  source: string;
}>;

const basic = `import { Module } from '@favy/di';

const Greeting = Module<{ name: string }>()(
  'Greeting',
  ({ name }) => \`Hello, \${name}!\`,
);

console.log(Greeting({ name: 'Ada' })); // Hello, Ada!`;

const composition = `import { Module, type Live } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => '2026-08-04T09:00:00.000Z',
}));
type ClockLive = Live<typeof Clock>;

const Timestamp = Module<ClockLive>()(
  'Timestamp',
  ({ Clock }) => \`Built at \${Clock.now()}\`,
);

console.log(Timestamp({ Clock })); // Built at 2026-08-04T09:00:00.000Z`;

const replace = `import { Module, type Live } from '@favy/di';

const Clock = Module()('Clock', () => ({
  now: () => new Date().toISOString(),
}));
type ClockLive = Live<typeof Clock>;

const Timestamp = Module<ClockLive>()(
  'Timestamp',
  ({ Clock }) => \`Built at \${Clock.now()}\`,
);

const FixedClock = {
  now: () => '2000-01-01T00:00:00.000Z',
};

console.log(Timestamp({ Clock: FixedClock }));
// Built at 2000-01-01T00:00:00.000Z`;

const partial = `import { Module } from '@favy/di';

const Add = Module<{ left: number; right: number }>()(
  'Add',
  ({ left, right }) => left + right,
);

const AddTen = Add.provide({ left: 10 });

console.log(AddTen({ right: 5 })); // 15`;

const lazyCache = `import { Module, type Live } from '@favy/di';

let resourceRuns = 0;
const Resource = Module()('Resource', () => ++resourceRuns);
type ResourceLive = Live<typeof Resource>;

const Ignore = Module<ResourceLive>()('Ignore', () => 'unused');
console.log(Ignore({ Resource }), resourceRuns); // unused 0

const ReadTwice = Module<ResourceLive>()(
  'ReadTwice',
  (deps) => [deps.Resource, deps.Resource],
);

console.log(ReadTwice({ Resource })); // [1, 1]
console.log(ReadTwice({ Resource })); // [2, 2]`;

const hkt = `import {
  makeModule,
  type HKT,
  type ModuleLive,
  type TModule,
} from '@favy/di';

type Box<Name, Result> = { name: Name; value: Result };
type BoxedModule<Name extends PropertyKey, Result, Deps> =
  TModule<Name, Deps, Box<Name, Result>>;

interface BoxHKT extends HKT {
  readonly type: BoxedModule<
    this['_NAME'],
    this['_RESULT'],
    this['_DEPS']
  >;
}

const BoxModule = makeModule({
  transformOutput: (result, deps) => ({
    name: (deps as unknown as ModuleLive).Module.name,
    value: result,
  }) as unknown as BoxHKT,
});

const Greeting = BoxModule()('Greeting', () => 'hello');
const output = Greeting();
const name: 'Greeting' = output.name;
const value: string = output.value;

console.log(\`\${name}: \${value}\`); // Greeting: hello`;

export const playgroundExamples: readonly PlaygroundExample[] = Object.freeze([
  {
    id: 'basic',
    title: 'Basic module',
    description: 'Create and call one named module.',
    source: basic,
  },
  {
    id: 'composition',
    title: 'Composition',
    description: 'Compose a timestamp from a typed clock provider.',
    source: composition,
  },
  {
    id: 'replace',
    title: 'Replace a boundary',
    description: 'Supply a deterministic clock value at the composition root.',
    source: replace,
  },
  {
    id: 'partial',
    title: 'Partial application',
    description:
      'Bind one dependency with `.provide()` and keep the remainder typed.',
    source: partial,
  },
  {
    id: 'lazy-cache',
    title: 'Lazy and cache',
    description: 'Skip an unused provider and reuse one value within each run.',
    source: lazyCache,
  },
  {
    id: 'hkt',
    title: 'HKT transform',
    description:
      'Wrap a result while preserving the module name and callback result type.',
    source: hkt,
  },
]);

export const playgroundExampleById = Object.freeze(
  Object.fromEntries(
    playgroundExamples.map((example) => [example.id, example])
  ) as Record<PlaygroundExampleId, PlaygroundExample>
);
