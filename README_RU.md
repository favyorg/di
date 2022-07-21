# Favy/di

Простой и мощный подход для внедрения зависимостей.
[![codecov](https://codecov.io/gh/favyorg/di/branch/master/graph/badge.svg?token=P42D5R2C14)](https://codecov.io/gh/favyorg/di)

## Examples

Легкое описание модулей.
```ts
const Api = Module('Api', ({baseUrl}: {baseUrl: string}) => ({
  request(path: string) {
    return fetch(`${baseUrl}${path}`).then((_) => _.json());
  },
}));
//   Так же легко запустить как просто вызов функции
Api({baseUrl: 'http://localhost/'}).request("/me")

// Для запуска нужно предоставить все зависимости нужного типа всех модулей
Api({ abc: 123 }).request("/me")
// Error: Argument of type '{ abc: number; }' is not assignable to parameter of type 'LocalDeps<{ baseUrl: string; }, true>'.

```
Легкая подмена зависимости на любом уровне.
```ts
const Api = Module('Api', () => ({
  request(path: string) {
    return fetch(path).then((_) => _.toJSON());
  },
}));
type ApiLive = Live<typeof Api>;

const App = Module('App', async ({ Api }: ApiLive) => {
  const res = await Api.request('/me');
  // ...
});

App({ Api, baseUrl: 'http://localhost/' }); // Run app

// Сan override for tests
const ApiMock = Module('ApiMock', () => ({
  request(path: string) {
    return new Promise<string>((res) => res(path));
  },
}));
type ApiMockLive = Live<typeof ApiMock>;

App({ Api: ApiMock, baseUrl: 'http://localhost/' });
```
Зависимости могут быть любого типа.

```ts
const Console = Module('Console', ({ prefix }: { prefix: string }) => ({
  log(text: string) {
    console.log(`${prefix} ${text}`);
  },
}));
type ConsoleLive = Live<typeof Console>;

const App = Module('App', async ({ Api }: ApiLive & ConsoleLive) => {
  Console.log('Fetching me');
  const res = await Api.request('/me');
  // ...
});

// Run app
App({ Api, Console, prefix: 'Info: ',baseUrl: 'http://localhost/' });
```
