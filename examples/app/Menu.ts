import { Module, Live } from '../../src/index';
import { ConsoleLive } from './Console';
import { StdInLive } from './StdIn';

export const Menu = Module('Menu', ({ Console, StdIn }: ConsoleLive & StdInLive) => ({
  async select(items: string[]) {
    while (true) {
      const text = `Menu:\n` + items.map((item, i) => `${i + 1}. ${item}`).join('\n');
      Console.log(text);

      const answer = Number(await StdIn.readOne()) - 1;

      if (Number.isNaN(answer) || answer < 0 || answer > items.length - 1) {
        Console.log(`\n\nError: Invalid value\n`);
        StdIn.clear();
        continue;
      }

      return answer;
    }
  },
}));

export type MenuLive = Live<typeof Menu>;
