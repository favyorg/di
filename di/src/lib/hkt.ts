export interface HKT {
  readonly _NAME: PropertyKey;
  readonly _RESULT?: unknown;
  readonly _DEPS?: unknown;
  readonly _PROV_DEPS?: unknown;
  readonly _CREATE?: unknown;

  readonly type?: unknown;
}

export type Kind<H extends HKT, NAME, RESULT, DEPS, PROV_DEPS, CREATE> = H extends {
  readonly type: unknown;
}
  ? (H & {
      readonly _NAME: NAME;
      readonly _RESULT: RESULT;
      readonly _DEPS: DEPS;
      readonly _PROV_DEPS: PROV_DEPS;
      readonly _CREATE: CREATE;
    })['type']
  : {
      readonly _H: H;
      readonly _NAME: (_: NAME) => void;
      readonly _RESULT: () => RESULT;
      readonly _DEPS: () => DEPS;
      readonly _PROV_DEPS: () => PROV_DEPS;
      readonly _CREATE: () => CREATE;
    };
