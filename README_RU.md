# Favy/di [![codecov](https://codecov.io/gh/favyorg/di/branch/master/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di) [![npm version](https://badge.fury.io/js/@favy%2Fdi.svg)](https://badge.fury.io/js/@favy%2Fdi) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@favy/di) ![GitHub](https://img.shields.io/github/license/favyorg/di?style=flat)

<img align="right" width="96" height="96" title="Favy logo"
     src="https://avatars.githubusercontent.com/u/101423384?s=400&u=5cf1213e9c56e3d9f2fcc6d131b80e00daf1c2bc&v=4">
Простой, мощный, типизированный и быстрый способ внедрения зависимостей.
- **Легкий.** 480 байт (после минификации и gzip). Без зависимостей.
- **Простой.** Так же простой как вызов функции, больше никаких IoC контейнеров.
- **Быстрый.** В разы быстрее tsyringe и inversify.
- **Безопасный.** При запуске требуются зависимости всех модулей и подмодулей.
- **Интегрируемый.** Это просто функция! Можно использовать только там где необходимо.
- **Работает везде.** Framework agnostic, Nodejs/Browser/ReactNative
```ts
import {Module} from "@favy/di";
const Hello = Module("Hello", ({name}: {name: string}) => `Hi ${name}!`);
Hello({name: "Alex"}); // Hi Alex!
```
Пример с несколькими модулями
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
// Нужно указать зависимости которые требуют все модули
App({ Logger, Hello, name: "Alex" }); // Hi Alex!

```
## Установка
```
npm install --save @favy/di
yarn add @favy/di
```
## Api

## Примеры

Легкое описание модулей.
```ts
const Api = Module('Api', ({baseUrl}: {baseUrl: string}) => ({
  request(path: string) {
    return fetch(`${baseUrl}${path}`).then((_) => _.json());
  },
}));
//   Так же легко запустить как просто вызов функции
Api({baseUrl: 'http://localhost/'}).request("/me")

// Для запуска нужно предоставить все зависимости нужного типа для всех модулей и подмодулей
Api({ abc: 123 }).request("/me")
//  ^____Error: Argument of type '{ abc: number; }' is not assignable to parameter of type 'LocalDeps<{ baseUrl: string; }, true>'.

```
Легкая подмена зависимостей.
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
Зависимости могут быть любого типа, модуль может возвращать любое значение.

```ts
const Console = Module('Console', ({ prefix }: { prefix: string }) => ({
  log(text: string) {
    console.log(`${prefix} ${text}`);
  },
}));
type ConsoleLive = Live<typeof Console>;

//                                     Легко комбинирование модулей
const App = Module('App', async ({ Api }: ApiLive & ConsoleLive) => {
  Console.log('Fetching me');
  const res = await Api.request('/me');
  // ...
});

// Run app
App({ Api, Console, prefix: 'Info: ',baseUrl: 'http://localhost/' });
```
### Сервисы
Сервис вызывается только один раз независимо от того где вызван.
Для сброса состояние вызова можно использовать метод .reset()
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

Большем примеров в папках [./examples/](https://github.com/favyorg/di/tree/master/examples) и [./__tests__/](https://github.com/favyorg/di/tree/master/__tests__)