import { makeModule, Module, type ModuleLive } from '../src/index';
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

test('---', () => {
  const LVL4 = Module()('LVL4', () => '4');
  type LVL4Live = Live<typeof LVL4>;

  const LVL3 = Module<LVL4Live>()('LVL3', ($) => $.LVL4 + '3');
  type LVL3Live = Live<typeof LVL3>;

  const LVL2 = Module<LVL3Live>()('LVL2', ($) => $.LVL3 + '2');
  type LVL2Live = Live<typeof LVL2>;

  const LVL1 = Module<LVL2Live>()('LVL1', ($) => $.LVL2 + '1');

  expect(LVL1({ LVL2, LVL3, LVL4 })).toBe('4321');
});

test('deep', () => {
  const A = Module()('A', ($) => ({ a: [$.Module.name.toString()] }));
  type ALive = Live<typeof A>;

  const A1 = Module()('A1', () => ({ a: ['A1'], x: [''] }));
  type A1Live = Live<typeof A1>;

  const A2 = Module()('A2', () => ({ a: ['A2'], x: [''] }));
  type A2Live = Live<typeof A2>;

  // 1
  const B = Module<ALive & A1Live & A2Live>()('B', ({ A }) => ({
    c: [A.a[0] + 'B'],
    x: '1',
  }));
  type BLive = Live<typeof B>;

  // 2
  const C = Module<BLive>()('C', ($) => ({ res: [$.B.c[0] + 'C'], z: 1 }));
  type CLive = Live<typeof C>;

  // 3
  const D = Module<CLive>()('D', ($) => $.C.res[0] + 'D');
  type DLive = Live<typeof D>;

  // 4
  const E = Module<DLive>()('E', ($) => [$.D + 'E']);
  type ELive = Live<typeof E>;

  // 5
  const F = Module<ELive>()('F', ($) => $.E[0] + 'F');
  type FLive = Live<typeof F>;

  // 6
  const G = Module<FLive>()('G', ($) => $.F + 'G');
  type GLive = Live<typeof G>;

  // 7
  const H = Module<GLive>()('H', ($) => $.G + 'H');
  type HLive = Live<typeof H>;

  // 8
  const I = Module<HLive>()('I', ($) => $.H + 'I');

  expect(I({ H, G, F, E, D, C, B, A, A1, A2 })).toBe('ABCDEFGHI');
});
