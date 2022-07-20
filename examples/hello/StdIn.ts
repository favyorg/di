import { Module, Live } from '../src/index';

export const StdIn = Module('StdIn', () => ({
  clear() {
    process.stdout.write('\n'.repeat(100));
  },
  readOne() {
    return new Promise<Buffer>((res) => {
      process.stdin.once('data', res);
    });
  },
}));

export type StdInLive = Live<typeof StdIn>;
