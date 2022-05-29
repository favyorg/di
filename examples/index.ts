import { Module } from '../src/index';
import { Console } from './Console';
import { Hi, HiLive } from './Hi';
import { Menu, MenuLive } from './Menu';
import { Ping, PingLive } from './Ping';
import { StdIn } from './StdIn';

const App = Module('App', async ({ Menu, Ping, Hi }: MenuLive & PingLive & HiLive) => {
  const Exit = () => process.exit(0);

  const commands = [Ping, Hi, Exit];

  while (true) {
    const answer = await Menu.select(['Ping', 'Hi', 'Exit']);
    await commands[answer]();
  }
});

App({ Menu, Console, StdIn, Ping, Hi, prefix: 'Hi' });
