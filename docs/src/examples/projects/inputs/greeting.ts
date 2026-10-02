import { Module } from '../../../../../di/src';

export const Greeting = Module<{ prefix: string }>()(
  'Greeting',
  ({ prefix }) => ({
    Say: (name: string) => `${prefix}, ${name}!`,
  })
);
export type GreetingLive = typeof Greeting.Live;
