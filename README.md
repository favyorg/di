# Favy/di

Type Safe depencency injection

[![Build Status](https://travis-ci.org/favy/di.svg?branch=master)](https://app.travis-ci.com/github/z81/lather)
[![Coverage Status](https://coveralls.io/repos/github/favy/lather/badge.svg?branch=master)](https://coveralls.io/github/z81/lather?branch=master)

## Examples

```ts
const Api = Module('Api', () => ({
  request(path: string) {
    return fetch(path).then((_) => _.toJSON());
  },
}));
type ApiLive = Live<typeof Api>;
//

const App = Module('App', async ({ Api }: ApiLive) => {
  const res = await Api.request('/me');
  // ...
});

// Run app
App({ Api });

// can override for tests
const ApiMock = Module('ApiMock', () => ({
  request(path: string) {
    return new Promise<string>((res) => res(path));
  },
}));
type ApiMockLive = Live<typeof ApiMock>;

App({ Api: ApiMock });
```

```ts
const Console = Module('Console', ({ prefix }: { prefix: string }) => ({
  log(text: string) {
    console.log(`${prefix} ${text}`);
  },
}));
type ConsoleLive = Live<typeof Console>;
//

const App = Module('App', async ({ Api }: ApiLive & ConsoleLive) => {
  Console.log('Fetching me');
  const res = await Api.request('/me');
  // ...
});

// Run app
App({ Api, Console, prefix: 'Info: ' });
```
