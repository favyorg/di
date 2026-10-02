import { makeModule } from '../../../../../di/src';

const CachedModule = makeModule({ cache: 'module' });
let starts = 0;

const Counter = CachedModule()('Counter', () => ++starts);
export type CounterLive = typeof Counter.Live;

console.log(Counter()); // 1
console.log(Counter()); // 1

CachedModule.flushCache();

console.log(Counter()); // 2
