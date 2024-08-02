import { Module, type ModuleLive } from '../src/index';
import type { Live } from '..';

test('---', () => {
  const A = Module()('A', () => 1);
  expect(A()).toBe(1);
});

test('---', () => {
  const A = Module<{ b: 1 }>()('A', ({ b }) => b + 1);
  expect(A({ b: 1 })).toBe(2);
});

test('---', () => {
  const A = Module()('A', ({ Module }) => Module.name);
  expect(A()).toBe('A');
});

test('---', () => {
  const A = Module<{ p: string } & ModuleLive>()(
    'A',
    ({ Module, p }) => p + Module.name.toString()
  );
  expect(A({ p: '+' })).toBe('+A');
});

test('---', () => {
  const A = Module()('A', () => Math.random());
  expect(A() !== A()).toBe(true);
});

test('---', () => {
  const A = Module()('A', () => 42);
  type ALive = Live<typeof A>;
  const B = Module()('B', () => 28);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ A, B })).toBe(70);
});

test('---', () => {
  const F = Module()('F', () => 15);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F + 42);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => 28 + F);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ F, B, A })).toBe(100);
});

test('---', () => {
  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F * 3);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => F * 4);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ F, B, A })).toBe(7);
});

test('---', () => {
  const F = Module()('F', () => Date.now());
  type FLive = Live<typeof F>;

  const A = Module<FLive>()('A', ({ F }) => F);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => F);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A === $.B);
  expect(C({ F, B, A })).toBe(true);
});

test('---', () => {
  const F = Module()('F', () => 'F');
  type FLive = Live<typeof F>;

  const A = Module()('A', () => 'A');
  type ALive = Live<typeof A>;

  const B = Module()('B', () => 'B');
  type BLive = Live<typeof B>;
  const C = Module<ALive & BLive & FLive>()('C', ($) => $.A + $.B + $.F);

  expect(C.provide({ F })({ B, A })).toBe('ABF');
  expect(C.provide({ F, A })({ B })).toBe('ABF');
  expect(C.provide({ F, A, B })()).toBe('ABF');
});

test('---', () => {
  const F = Module()('F', () => 'F');
  type FLive = Live<typeof F>;

  const A = Module()('A', () => 'A');
  type ALive = Live<typeof A>;

  const B = Module()('B', () => 'B');
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive & FLive>()('C', ($) => $.A + $.B + $.F);

  expect(C.provide({ F: 'F', A })({ B: 'B' })).toBe('ABF');
});

test('---', () => {
  const A = Module()('A', () => 'A');
  type ALive = Live<typeof A>;

  const B = Module<ALive>()('B', ({ A }) => A + 'B');
  type BLive = Live<typeof B>;

  const C = Module<BLive>()('C', ($) => $.B + 'C');
  type CLive = Live<typeof C>;

  const D = Module<CLive>()('D', ($) => $.C + 'D');
  type DLive = Live<typeof D>;

  const E = Module<DLive>()('E', ($) => $.D + 'E');
  type ELive = Live<typeof E>;

  const F = Module<ELive>()('F', ($) => $.E + 'F');

  expect(F({ E, D, C, B, A })).toBe('ABCDEF');
});
