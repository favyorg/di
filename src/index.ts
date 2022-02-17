const ModuleTag = Symbol('Module');

type Live<T> = {
  [k in keyof T]: k extends `create${infer N}` ? T[k] : T[k] extends (deps: infer D) => infer R ? R : never;
};

type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (x: infer R) => any ? R : never;

const Module = <D extends unknown, R extends unknown = unknown, N extends string = string>(
  name: N extends '' ? never : N,
  create: (deps: D) => R,
) => {
  const fn = (
    ...args: unknown extends D
      ? []
      : [
          deps: {
            [k in keyof D]: k extends `create${infer N}`
              ? D[k]
              : k extends string
              ? D extends { [kk in `create${k}`]: infer R }
                ? R
                : never
              : never;
          } & UnionToIntersection<
            {
              [k in keyof D]: k extends `create${infer N}` ? Omit<D[k] extends (deps: infer DD) => infer R ? DD : D[k], 'name'> : never;
            }[keyof D]
          >,
        ]
  ) => {
    const deps = args[0] ?? {};
    // @ts-ignore
    const resDeps = args[4] ?? {};

    for (let k in deps) {
      if (name !== k && !k.startsWith('create') && !(k in resDeps)) {
        Object.defineProperty(resDeps, k, {
          get: () => {
            // @ts-ignore
            const value = deps[k](deps, undefined, undefined, undefined, resDeps);

            Object.defineProperty(resDeps, k, {
              value,
            });

            return value;
          },
          enumerable: false,
          configurable: true,
        });
      }
    }

    return create(resDeps as D);
  };

  // fix intersection
  // (fn as any).tag = ModuleTag;
  // @ts-expect-error
  fn[name] = fn;
  // @ts-expect-error
  fn[`create${name as N}`] = fn;

  return fn as typeof fn & {
    [k in `create${N}` | N]: typeof fn;
  };
};

//
const Console = Module('Console', () => {
  console.log('Create Console');

  return {
    error: (message: string) => console.error(`[Console] ${message}`),
    log: (message: string) => console.log(`[Console] ${message}`),
  };
});
type ConsoleLive = Live<typeof Console>;

// ----
const ConsoleWithTime = Module('ConsoleWithTime', ({ Console }: ConsoleLive) => {
  return {
    error: (message: string) => Console.error(`[${new Date()}] ${message}`),
    log: (message: string) => Console.log(`[${new Date()}] ${message}`),
  };
});

type ConsoleWithTimeLive = Live<typeof ConsoleWithTime>;

// ---
const SomeApi = Module('SomeApi', ({ ConsoleWithTime }: ConsoleWithTimeLive) => {
  console.log('Create Some Api');

  return new (class {
    fetch() {
      ConsoleWithTime.log('SomeApi fetch');
      return new Promise<string[]>((res) => res(['data']));
    }
  })();
});

type SomeApiLive = Live<typeof SomeApi>;
// ----
const App = Module('App', ({ SomeApi, Console }: SomeApiLive & ConsoleLive) => {
  Console.log('Create App');

  return class {
    static run() {
      Console.log('App run');
      return SomeApi.fetch();
    }
  };
});

const app = App({
  ...SomeApi,
  ...Console,
  ...ConsoleWithTime,
});

app.run();
