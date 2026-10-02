import { Greeting } from './greeting';
import { DefaultMessages } from './messages';

const ReadyMessages = DefaultMessages.provide({ prefix: 'Hello' });
export type ReadyMessagesLive = typeof ReadyMessages.Live;

console.log(Greeting({ Messages: ReadyMessages })); // Hello, Alex!
