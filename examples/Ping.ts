import { Module, Live } from '../src/index';
import { ConsoleLive } from './Console';
import { StdInLive } from './StdIn';

export const Ping = Module('Ping', ({ Console, StdIn }: ConsoleLive & StdInLive) => () => {
  StdIn.clear();
  Console.log('Pong\n');
});

export type PingLive = Live<typeof Ping>;
