export interface HKT {
  readonly _NAME: PropertyKey;
  readonly _RESULT?: unknown;
  readonly _DEPS?: unknown;
  readonly _META?: unknown;
  readonly _META2?: unknown;

  readonly type?: unknown;
}

export type Kind<H extends HKT, NAME, RESULT, DEPS, META, META2> = H extends {
  readonly type: unknown;
}
  ? (H & {
      readonly _NAME: NAME;
      readonly _RESULT: RESULT;
      readonly _DEPS: DEPS;
      readonly _META: META;
      readonly _META2: META2;
    })['type']
  : {
      readonly _H: H;
      readonly _NAME: (_: NAME) => void;
      readonly _RESULT: () => RESULT;
      readonly _DEPS: () => DEPS;
      readonly _META: () => META;
      readonly _META2: () => META2;
    };
