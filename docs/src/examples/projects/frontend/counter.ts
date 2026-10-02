import { Module } from '../../../../../di/src';

export const Counter = Module<{ step: number }>()('Counter', ({ step }) => {
  let count = 0;
  return { Increment: () => (count += step) };
});
export type CounterLive = typeof Counter.Live;
