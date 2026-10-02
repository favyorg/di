import { Greeting } from './greeting';
import { Messages } from './messages';

export const EnglishGreeting = Greeting.provide({ Messages }).provide({
  locale: 'en',
});
export type EnglishGreetingLive = typeof EnglishGreeting.Live;

const greeting = EnglishGreeting({ prefix: 'Hello' });
console.log(greeting.Say('Alex')); // Hello, Alex! (en)
