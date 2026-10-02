import { makeModule, type HKT, type TModule } from '../../../../../di/src';

type Box<T> = { value: T };

interface BoxHKT extends HKT {
  readonly type: TModule<this['_NAME'], this['_DEPS'], Box<this['_RESULT']>>;
}

export const BoxModule = makeModule({
  transformOutput: (value) => ({ value } as unknown as BoxHKT),
});
