import {
  Module,
  GenModule,
  makeModule,
  makeGenModule,
} from '../../../../../di/src';

const Plain = makeModule();
const Generated = makeGenModule();

const Word = Module()('Word', () => 'Hello');
export type WordLive = typeof Word.Live;

const Phrase = Generated<WordLive>()('Phrase', function* ({ Word }) {
  return `${Word}, Alex!`;
});
export type PhraseLive = typeof Phrase.Live;

const Greeting = GenModule()('Greeting', function* () {
  return yield* Phrase;
});
export type GreetingLive = typeof Greeting.Live;

const Main = Plain<GreetingLive>()('Main', ({ Greeting }) => Greeting);
export type MainLive = typeof Main.Live;

console.log(Main({ Word, Phrase, Greeting })); // Hello, Alex!
