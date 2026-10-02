import { Module } from '../../../../../di/src';
import type { MessagesLive } from './messages';

export const Greeting = Module<MessagesLive>()(
  'Greeting',
  ({ Messages }) => `${Messages.hello}, Alex!`
);
export type GreetingLive = typeof Greeting.Live;
