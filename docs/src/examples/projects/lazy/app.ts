import { makeModule } from '../../../../../di/src';

const DemoModule = makeModule({ lazy: true });
let starts = 0;

const Counter = DemoModule()('Counter', () => ++starts);
export type CounterLive = typeof Counter.Live;

const ReadCounter = DemoModule<CounterLive & { enabled: boolean }>()(
  'ReadCounter',
  (deps) => (deps.enabled ? deps.Counter : 'unused')
);
export type ReadCounterLive = typeof ReadCounter.Live;

console.log(ReadCounter({ Counter, enabled: false })); // unused
console.log(starts); // 0
