# Pull based typesafe stream library
[chain type DI] [safe(Result<T> | Fail<E>) or unsafe(exception | data)]
[![npm version](https://badge.fury.io/js/@lather%2Fcore.svg)](https://badge.fury.io/js/@lather%2Fcore)
[![Build Status](https://travis-ci.org/z81/lather.svg?branch=master)](https://app.travis-ci.com/github/z81/lather)
[![Coverage Status](https://coveralls.io/repos/github/z81/lather/badge.svg?branch=master)](https://coveralls.io/github/z81/lather?branch=master)
# Installation
`yarn add @lather/core` or `npm i @lather/core`
# Docs
https://z81.github.io/lather/
# Full examples
[src/examples/](https://github.com/z81/lather/tree/master/src/examples)
# Short examples
```ts
console.log('Sync task:', Task.succeed(1).map(n => n * 2).runUnsafe())
// Sync task: 4
```

```ts
console.log('Async task:', await Task.succeed(1).map(n => n * 2).delay(1000).runUnsafe())
// Async task: 4     after 1000ms
```

```ts
console.log('Sync safe task:', Task.succeed(1).map(n => n * 2).run())
// Sync safe task: Result { value: 4 }
```

```ts
try {
  console.log('Sync unsafe task:', Task.succeed(1).map(n => {throw new Error()}).runUnsafe())
} catch(e) {
  console.error("error", e)
}
// error Error
```
```ts
console.log('Sync safe task:', Task.succeed(1).map(n => {throw new Error()}).run()))
// Sync safe task: Fail {error: Error}
```


```ts
let i = 0;
const r = Task.succeed(1).map(n => {
  if (++i < 3) {
    throw "Error i < 3!!!"
  }
  return i;
}).retryWhile(() => true).run() // or .retryWhile(Conditions.always)
// r = 4
```

```ts
let i = 0;
const r = Task.succeed(1).map(n => {
  if (++i < 3) {
    throw "Error i < 3!!!"
  }
  return i;
}).retryWhile(Conditions.times(7)).run()
// r = 4
```

```ts
Task.succeed(1).access<{logger: (msg: string) => void}>().run()
//                                          type error----^^^^^
/*                                 ... {
                                    logger: {
                                        Error: "Incorrect dependencies";
                                        Field: "logger";
                                        RequiredValue: (msg: string) => void;
                                        ExceptedValue: undefined;
                                    }
                                  }...
*/
```

```ts
const serviceWithLogging = Task.succeed(1)
  .access<{ logger: (msg: string) => void }>()
  .map(({ logger }) => logger("Hi !"));

serviceWithLogging.provide({ logger: console.log }).run();
// Hi!
```

```ts
const serviceWithLogging = Task.succeed(1)
  .access<{ logger: (msg: string) => void }>()
  .map(({ logger }) => logger("Hi !"));

const app = serviceWithLogging
  .provide({ logger: console.log })

// override for test
app.provide({ logger: (msg: string) => mock("Log", msg) })
  .run();
// mock called with ["Log", "Hi!"]
```


```ts
let i = 0;
const r = Task.succeed(1).map(n => {
  if (++i < 3) {
    throw "Error i < 3!!!"
  }
  return i;
}).mapError(e => `Omg! ${e}`).run()
// r = Fail {value: "Omg! Error i < 3!!!"}
```

```ts
const openDb = () => console.log("open db");
const closeDb = () => console.log("close db");
const writeDb = () => console.log("write db");

Task.succeed(1)
  .map(openDb)
  .ensure(closeDb) // run after end
  .map(writeDb)
  .map((n) => {
    throw "Error ";
  })
  .run();
// open db
// write db
// close db
```
```ts
const t = Task.sequenceFrom([1, 2, 3]) // any iterable value
  .reduce((a, b) => a + b, 0)
  .runUnsafe();
console.log(t);
```

```ts
const t = Task.sequenceFrom("test")
  .reduce((a, b) => `${b}/${a}`, "")
  .runUnsafe();
console.log(t);
//  /t/e/s/t
```
```ts
const t = Task.sequenceFrom(new Set([1, 2, 3]))
  .reduce((a, b) => a + b, 0)
  .runUnsafe();
console.log(t); // 6
```
```ts
const t = Task.sequenceGen(function* () {
  yield 1;
  yield 2;
  yield 3;
})
  .reduce((a, b) => a + b, 0)
  .runUnsafe();
console.log(t); // 6
```

map
mapError
mapTo
tap
chain
repeatWhile
repeat
sequenceGen
sequenceFromIterable
sequenceFromObject
reduce
retryWhile
timeout
access
provide
collectWhen
collectAll
ensureAll
ensure
delay