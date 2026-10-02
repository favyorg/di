import { Module } from '../../../../../di/src';

export const Greeting = Module()('Greeting', () => ({
  Say: (name: string) => `Hello, ${name}!`,
}));
