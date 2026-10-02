import { Module } from '../../../../../di/src';
import { Greeting, type GreetingLive } from './greeting';

const Main = Module<GreetingLive>()('Main', ({ Greeting }) => Greeting);
export type MainLive = typeof Main.Live;

const box = Greeting({ name: 'Alex' });
console.log(box.value); // Hello, Alex!
console.log(`root: ${box.isRoot}`); // root: true
console.log(`nested: ${Main({ name: 'Alex', Greeting }).isRoot}`); // nested: false
