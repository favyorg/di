# Favy/di

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
