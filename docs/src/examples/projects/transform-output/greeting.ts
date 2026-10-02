import { BoxModule } from './factory';

export const Greeting = BoxModule<{ name: string }>()(
  'Greeting',
  ({ name }) => `Hello, ${name}!`
);
export type GreetingLive = typeof Greeting.Live;
