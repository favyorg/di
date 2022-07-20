import { Module, Live } from '../../src/index';

export const Console = Module('Console', () => ({
  log(text: string) {
    console.log(text);
  },
}));

export type ConsoleLive = Live<typeof Console>;
