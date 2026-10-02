import { Greeting } from './greeting';
import { Messages } from './messages';

const greeting = Greeting({ prefix: 'Hello', locale: 'en', Messages });
console.log(greeting.Say('Alex')); // Hello, Alex! (en)
