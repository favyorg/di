import { Greeting } from './greeting';
import { DefaultMessages } from './messages';

const greeting = Greeting({ Messages: DefaultMessages });
console.log(greeting.Say('Alex')); // Hello, Alex!
