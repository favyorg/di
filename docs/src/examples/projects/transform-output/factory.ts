import { makeModule } from '../../../../../di/src';

export const BoxModule = makeModule({
  transformOutput: (value: string, _deps, isRoot) => ({ value, isRoot }),
});
