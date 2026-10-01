import { Module } from '../../../di/src';

const Clock = Module()('Clock', () => ({
  now: () => new Date(),
}));
type ClockLive = typeof Clock.Live;

// prettier-ignore
const Greeting = Module<ClockLive>()(
  'Greeting',
  ({ Clock }) => ({
    message: () => 'Hello at ' + Clock.now().toISOString(),
  }),
);
type GreetingLive = typeof Greeting.Live;

export const runGreeting = () => Greeting({ Clock }).message();
