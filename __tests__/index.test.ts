import { Live, Module, Service } from '../src/index';

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

test('deep deps', () => {
  const X = Module('X', ({ a }: { a: 2 }) => {
    return {
      svcsd: 13,
    };
  });
  type XLive = Live<typeof X>;

  const Fetch = Module('Fetch', ({}: XLive) => {
    return {
      ascasc: 324,
    };
  });
  type FetchLive = Live<typeof Fetch>;

  const Store = Module('Store', ({ Fetch }: FetchLive) => {
    return {
      abc: 1,
    };
  });
  type StoreLive = Live<typeof Store>;

  const Store2 = Module('Store', ({ Fetch }: FetchLive) => {
    return { abc: 1 };
  });

  const Main = Module('Main', ({}: StoreLive) => {});

  Fetch({ X, a: 2 });
  Store({ Fetch, X, a: 2 });
  Main({
    Fetch,
    Store: Store2,
    X,
    a: 2,
  });

});


test('provide some deps', () => {
  const A = Module('A', ({ path }: { path: string }) => {
    return path;
  });
  type ALive = Live<typeof A>;

  const B = Module('B', ({A}: ALive) => {
    return A;
  });
  type BLive = Live<typeof B>;

  const C = Module('C', ({B}: BLive) => {
    return B;
  });


  const part = C.provide({ A });
  const part2 = part.provide({ B });

  expect(C({ path: 'test', B, A })).toBe('test');
  expect(part({ path: 'test', B })).toBe('test');
  expect(part2({ path: 'test' })).toBe('test');
});


test('duplicate deps', () => {
  let i = 0;
  const A = Module('A', ({ path }: { path: string }) => {
    return `${path}${i++}`;
  });
  type ALive = Live<typeof A>;

  const B1 = Module('B1', ({A}: ALive) => {
    return A;
  });
  type B1Live = Live<typeof B1>;

  const B2 = Module('B2', ({A}: ALive) => {
    return A;
  });
  type B2Live = Live<typeof B2>;

  const C = Module('C', ({B2, B1, A}: B1Live & B2Live & ALive) => {
    return B2 + B1 + A;
  });

  expect(C({ path: 'test', B1, B2, A })).toBe('test0test0test0');
});
