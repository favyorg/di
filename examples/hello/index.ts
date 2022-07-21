import { Module, Live } from '../../src/index';

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




{
  const Api = Module('Api', ({ baseUrl }: { baseUrl: string }) => ({
    request(path: string) {
      return fetch(`${baseUrl}${path}`).then((_) => _.json());
    },
  }));

  Api({ abc: 123 }).request("/me")
}