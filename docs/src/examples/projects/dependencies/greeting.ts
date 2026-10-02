import { Module } from '../../../../../di/src';
import type { MessagesLive } from './messages';

export const Greeting = Module<MessagesLive>()('Greeting', ({ Messages }) => ({
  Say: (name: string) => `${Messages.hello}, ${name}!`,
}));
