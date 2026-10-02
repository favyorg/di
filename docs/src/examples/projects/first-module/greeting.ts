import { Module } from '../../../../../di/src';

export const Greeting = Module()('Greeting', () => ({
  Say: (name: string) => `Hello, ${name}!`,
}));
export type GreetingLive = typeof Greeting.Live;
