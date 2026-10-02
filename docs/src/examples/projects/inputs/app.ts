import { Greeting } from './greeting';

const greeting = Greeting({ prefix: 'Hello' });
console.log(greeting.Say('Alex')); // Hello, Alex!
