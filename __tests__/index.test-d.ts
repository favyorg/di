import { expectAssignable, expectType, expectError } from 'tsd';
import { Live, Module } from '../src/index';

// deps type
expectError(
  Module(
    'test',
    (deps: { path: string }) => deps,
  )({
    path: 1,
  }),
);

expectError(Module('test', (deps: { path: string }) => deps)({}));

expectError(Module('test', (deps: { path: string }) => deps)(1));

// deps args
expectError(Module('test', (deps) => deps)({}));

// deps
expectType(
  Module(
    'test',
    (deps: { path: string }) => deps,
  )({
    path: 'str',
  }),
);

// return type
expectType<string>(
  Module(
    'test',
    (deps: { path: string }) => deps.path,
  )({
    path: 'str',
  }),
);

const App = Module('App', ({ path }: { path: string }) => path);
type AppLive = Live<typeof App>;

expectError(
  Module(
    'test',
    (deps: AppLive & { local: string }) => 123,
  )({
    path: 'str',
  }),
);

expectType(
  Module(
    'test',
    (deps: AppLive & { local: string }) => 123,
  )({
    path: 'str',
    App,
    local: 'string',
  }),
);

expectError(
  Module(
    'test',
    (deps: AppLive & { local: string }) => 123,
  )({
    path: 'str',
    ...App,
  }),
);

expectError(
  Module(
    'test',
    (deps: AppLive & { local: string }) => 123,
  )({
    ...App,
  }),
);

const Log = Module('Log', (deps: { path: number }) => deps.path);
type LogLive = Live<typeof Log>;

// bad intersection
expectError(
  Module(
    'test',
    (deps: LogLive & AppLive & { local: string }) => 123,
  )({
    path: 23,
    App,
    Log,
    local: 'string',
  }),
);

const Xa = Module('Xa', ({ App }: AppLive) => App);
type XaLive = Live<typeof Xa>;

expectType(
  Module(
    'test',
    (deps: XaLive) => deps.Xa,
  )({
    ...App,
    ...Xa,
    path: '',
  }),
);

expectError(
  Module(
    'test',
    (deps: XaLive) => deps.Xa,
  )({
    ...App,
    ...Xa,
  }),
);

expectError(
  Module(
    'test',
    (deps: XaLive) => deps.Xa,
  )({
    ...App,
    ...Xa,
    path: 23,
  }),
);

expectError(
  Module(
    'test',
    (deps: XaLive) => deps.Xa,
  )({
    ...App,
    path: '23',
  }),
);

expectError(
  Module(
    'test',
    (deps: XaLive) => deps.Xa,
  )({
    ...Xa,
    path: '23',
  }),
);
