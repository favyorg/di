import { makeModule, withModuleName } from '..';
import type { Live } from '..';

test('---', () => {
  const Module = makeModule({
    transformInput: () => {
      return 1;
    },
  });
  const A = Module()('A', () => 1);
  expect(A()).toBe(1);
});

test('---', () => {
  const Module = makeModule({
    transformInput: withModuleName,
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F * 3);
  type ALive = Live<typeof A>;

  const B = Module<FLive>()('B', ({ F }) => F * 4);
  type BLive = Live<typeof B>;

  const C = Module<ALive & BLive>()('C', ($) => $.A + $.B);
  expect(C({ F, B, A })).toBe(7);
});

test('---', () => {
  const Module = makeModule({
    cache: 'module'
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  A({ F });
  A({ F });
  expect(A({ F })).toBe(1);
});

test('---', () => {
  const Module = makeModule({
    cache: 'module'
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  A({ F });
  Module.flushCache()
  A({ F });
  expect(A({ F })).toBe(2);
});


test('---', () => {
  const Module = makeModule({
    cache: 'run'
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  A({ F });
  Module.flushCache()
  A({ F });
  expect(A({ F })).toBe(3);
});

test('---', () => {
  const Module = makeModule({
    cache: 'run'
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  const B = Module<(typeof A)['Live'] & FLive>()('A', ({ F, A }) => F + A);
  expect(B({ F, A })).toBe(2);
});

test('---', () => {
  const Module = makeModule({
    cache: 'run'
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  const B = Module<(typeof A)['Live'] & FLive>()('A', ({ F, A }) => F + A);
  B({ F, A });
  B({ F, A });
  expect(B({ F, A })).toBe(6);
});

test('---', () => {
  const Module = makeModule({
    cache: 'none'
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  const B = Module<(typeof A)['Live'] & FLive>()('A', ({ F, A }) => F + A);
  expect(B({ F, A })).toBe(3);
});


test('---', () => {
  const Module = makeModule({
    lazy: true
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  expect(A({ F })).toBe(1);
});

test('---', () => {
  const Module = makeModule({
    lazy: true
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', () => 0);
  A({ F });
  expect(i).toBe(0);
});


test('---', () => {
  const Module = makeModule({
    lazy: false
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', () => 0);
  A({ F });
  expect(i).toBe(1);
});


test('---', () => {
  const Module = makeModule({
    lazy: false
  });

  let i = 0;
  const F = Module()('F', () => ++i);
  type FLive = (typeof F)['Live'];

  const A = Module<FLive>()('A', ({ F }) => F);
  expect(A({ F })).toBe(2);
});
