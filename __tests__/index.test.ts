import { Live, Module } from '../src/index';

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
