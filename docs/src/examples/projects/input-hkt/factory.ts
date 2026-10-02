import { makeModule, type HKT } from '../../../../../di/src';

type Wrapped<T> = { wrapped: T };

interface WrappedInput extends HKT {
  readonly type: Wrapped<this['_DEPS']>;
}

export const WrappedModule = makeModule({
  transformInput: (deps) => ({ wrapped: deps } as unknown as WrappedInput),
});
