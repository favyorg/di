import { makeModule } from '../../../../../di/src';

const DemoModule = makeModule({ cache: 'run' });
let starts = 0;

const Counter = DemoModule()('Counter', () => ++starts);
export type CounterLive = typeof Counter.Live;

const ReadTwice = DemoModule<CounterLive>()(
  'ReadTwice',
  (deps) => `${deps.Counter}, ${deps.Counter}`
);
export type ReadTwiceLive = typeof ReadTwice.Live;

console.log(ReadTwice({ Counter })); // 1, 1
console.log(ReadTwice({ Counter })); // 2, 2
