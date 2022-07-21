# Favy/di [![codecov](https://codecov.io/gh/favyorg/di/branch/master/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di) [![npm version](https://badge.fury.io/js/@favy%2Fdi.svg)](https://badge.fury.io/js/@favy%2Fdi) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@favy/di) ![GitHub](https://img.shields.io/github/license/favyorg/di?style=flat)

<img align="right" width="96" height="96" title="Favy logo"
     src="https://avatars.githubusercontent.com/u/101423384?s=400&u=5cf1213e9c56e3d9f2fcc6d131b80e00daf1c2bc&v=4">
Easy, Powerful, type safe and fast way for dependency injection.
- **Light.** 480 bytes (after minification and gzip). No dependencies.
- **Easy.** As easy as calling the function, no more IoC containers.
- **Fast.** Match faster than tsyringe and inversify.
- **Safe.** Typescript checking all dependencies in all modules and submodules when function is needed to be called.
- **Integrated.** It's just a function! You can include it everywhere you want.
- **Works everywhere.** Framework agnostic, Nodejs/Browser/ReactNative
```ts
import {Module} from "@favy/di";
const Hello = Module("Hello", ({name}: {name: string}) => `Hi ${name}!`);
Hello({name: "Alex"}); // Hi Alex!
```
Example with multiple modules:
```ts
import {Module, Live} from "@favy/di";

const Hello = Module("Hello", ({ name }: { name: string }) => `Hi ${name}!`);
type HelloLive = Live<typeof Hello>;

const Logger = Module("Logger", () => ({
  log(message: string) {
    console.log(message)
  }
}));
type LoggerLive = Live<typeof Logger>;

const App = Module("App", ({ Hello, Logger }: HelloLive & LoggerLive) => {
  Logger.log(Hello)
});

App({ name: "Alex" });
// ^___Error: Argument of type '{ name: string; }' is not assignable to parameter oftype 'ModuleDeps<HelloLive & LoggerLive, true>'.
// You need to specify the dependencies of all modules
App({ Logger, Hello, name: "Alex" }); // Hi Alex!

```
## Install
```
npm install --save @favy/di
yarn add @favy/di
```
## Api

## Examples

Easy description of the modules.
```ts
const Api = Module('Api', ({baseUrl}: {baseUrl: string}) => ({
  request(path: string) {
    return fetch(`${baseUrl}${path}`).then((_) => _.json());
  },
}));
//   As easy to run as a simple function call
Api({baseUrl: 'http://localhost/'}).request("/me")

// To start, you must provide all dependencies for all modules and submodules of the correct type
Api({ abc: 123 }).request("/me")
//  ^____Error: Argument of type '{ abc: number; }' is not assignable to parameter of type 'LocalDeps<{ baseUrl: string; }, true>'.

```
Easy replacement of any dependencies.
```ts
const Logger = Module('Logger', ({ prefix }: { prefix: string }) => ({
  log(message: string) {
    console.log(`[${prefix} ${new Date().toISOString()}] ${message}`);
  }
}));
type LoggerLive = Live<typeof Logger>;

const App = Module('App', ({ Logger }: LoggerLive) => {
  Logger.log("starting...");
  // ...
});

App({ Logger, prefix: 'myService' })
// [myService 2022-07-21T08:04:10.658Z] starting...

const JSONLogger = Module('JSONLogger', ({ prefix }: { prefix: string }) => ({
  log(message: string) {
    console.log(JSON.stringify({ prefix, dateTime: Date.now(), message }));
  }
}));

App({ Logger: JSONLogger, prefix: 'myService' })
// {"prefix":"myService","dateTime":1658390747811,"message":"starting..."}

const MyService = App.provide({ prefix: 'myService' });
MyService({ Logger })
//[myService 2022-07-21T08:09:13.079Z] starting...
MyService({ Logger: JSONLogger })
//{"prefix":"myService","dateTime":1658390972822,"message":"starting..."}
```
Dependencies can be any type, the module can return any value.
```ts
const Console = Module('Console', ({ prefix }: { prefix: string }) => ({
  log(text: string) {
    console.log(`${prefix} ${text}`);
  },
}));
type ConsoleLive = Live<typeof Console>;

//                                       Easy to combine modules
const App = Module('App', async ({ Api }: ApiLive & ConsoleLive) => {
  Console.log('Fetching me');
  const res = await Api.request('/me');
  // ...
});

// Run app
App({ Api, Console, prefix: 'Info: ',baseUrl: 'http://localhost/' });
```
### Services
The service is called once, no matter where it is called.
You can use the .reset() method to reset the call state.
```ts
  let i = 0;

  const A = Service('A', ({ path }: { path: string }) => {
    return `${path}${i++}`;
  });

  console.log(A({ path: 'test' }));// test0
  console.log(A({ path: 'test' }));// test0
  A.reset();
  console.log(A({ path: 'test' }));// test1
  console.log(A({ path: 'test' }));// test1
```

More examples in the folders [./examples/](https://github.com/favyorg/di/tree/master/examples) and [./__tests__/](https://github.com/favyorg/di/tree/master/__tests__)