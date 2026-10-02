import { Greeting } from './greeting';
import { Messages } from './messages';

const inputs = { prefix: 'Hello', locale: 'en' };
const original = Greeting({ ...inputs, Messages });
const replacement = Greeting({
  ...inputs,
  Messages: { hello: 'Hi', locale: 'en' },
});

console.log(original.Say('Alex')); // Hello, Alex! (en)
console.log(replacement.Say('Alex')); // Hi, Alex! (en)
