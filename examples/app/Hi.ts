import { Module, Live } from '../../src/index';
import { ConsoleLive } from './Console';
import { StdInLive } from './StdIn';

export const Hi = Module('Hi', ({ Console, prefix, StdIn }: ConsoleLive & StdInLive & { prefix: string }) => {
  return async () => {
    StdIn.clear();
    Console.log('Your name:\n');
    const text = await StdIn.readOne();

    StdIn.clear();
    Console.log(`${prefix} ${text.toString().replace('\n', '')}!\n`);
  };
});

export type HiLive = Live<typeof Hi>;
