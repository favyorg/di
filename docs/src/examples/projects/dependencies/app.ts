import { Greeting } from './greeting';
import { Messages } from './messages';

const greeting = Greeting({ Messages });
console.log(greeting.Say('Alex')); // Hello, Alex!
