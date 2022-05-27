import { Live, LiveDeps, Module, Service } from '../src/index';

test('return val', () => {
  expect(Module('N', () => 1)()).toBe(1);
});

test('return from deps num', () => {
  expect(Module('N', ({ a }: { a: number }) => a)({ a: 1 })).toBe(1);
});

test('return from deps fn', () => {
  expect(
    Module(
      'N',
      ({ a }: { a: string }) =>
        () =>
          a,
    )({ a: '1' })(),
  ).toBe('1');
});

test('sub module deps spread', () => {
  const Ma = Module('Ma', ({ a }: { a: number }) => a);
  type MaLive = Live<typeof Ma>;

  const N = Module('N', ({ Ma, b }: MaLive & { b: number }) => Ma + b);
  expect(N({ a: 2, b: 2, ...Ma })).toBe(4);
});

test('sub module deps', () => {
  const Ma = Module('Ma', ({ a }: { a: number }) => a);
  type MaLive = Live<typeof Ma>;

  const N = Module('N', ({ Ma, b }: MaLive & { b: number }) => Ma + b);
  expect(N({ a: 2, b: 2, Ma })).toBe(4);
});

test('module call', () => {
  let i = 0;
  const Ma = Module('Ma', () => i++);
  Ma();
  Ma();

  expect(Ma()).toBe(2);
});

test('module call', () => {
  let i = 0;
  const Ma = Module('Ma', () => i++);
  type MaLive = Live<typeof Ma>;

  const Ha = Module('Ha', ({ Ma }: MaLive) => Ma);
  Ha({ Ma });
  Ha({ Ma });

  expect(Ha({ Ma })).toBe(2);
});

test('module call', () => {
  let i = 0;
  const Ma = Module('Ma', () => i++);
  type MaLive = Live<typeof Ma>;

  const Ha = Module('Ha', ({ Ma }: MaLive) => Ma);
  Ha({ Ma });
  Ma();

  expect(Ha({ Ma })).toBe(2);
});

test('service call', () => {
  let i = 0;
  const Ma = Service('Ma', () => i++);
  type MaLive = Live<typeof Ma>;

  const Ha = Service('Ha', ({ Ma }: MaLive) => Ma);
  Ha({ Ma });
  Ma();

  expect(Ha({ Ma })).toBe(0);
});

test('deps', () => {
  const Fetch = Module('Fetch', ({ baseUrl }: { baseUrl: string }) => {
    return () => {};
  });
  type FetchLive = Live<typeof Fetch>;

  const Store = Module('Store', ({ Fetch }: FetchLive) => {
    return () => {
      Fetch();
    };
  });
  type StoreLive = Live<typeof Store>;

  const Main = Module('Main', ({ Store }: StoreLive) => {
    return () => {
      Store();
    };
  });

  Main({
    Fetch,
    Store,
    baseUrl: '!',
  });
});

// test('cycle deps', () => {
//   const Ma = Module('Ma', ({ Ha }: Live<Module<'Ha', { inc(): number }, { i: number; inc(): number }>>) => ({
//     //{ Ha: { i: number } }) => ({

//     inc() {
//       return Ha.i + 1;
//     },
//   }));
//   type MaLive = Live<typeof Ma>;

//   const Ha = Module('Ha', (deps: MaLive) => ({
//     i: 0,
//     inc() {
//       return deps.Ma.inc();
//     },
//   }));

//   type HaLive = Live<typeof Ha>;

//   const App = Module('App', (deps: HaLive) => {
//     return deps.Ha.inc();
//   });

//   expect(App({ Ha, Ma })).toBe(0);
// });
