import { Greeting } from './greeting';

// The input transform supplies prefix and Module; callers supply neither.
console.log(Greeting().Say('Alex')); // Greeting: Hello, Alex!
