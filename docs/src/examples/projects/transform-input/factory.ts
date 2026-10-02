import { makeModule, withModuleName } from '../../../../../di/src';

export const MetadataModule = makeModule({
  transformInput: <D extends object>(deps: D, name: PropertyKey) =>
    Object.assign(deps, withModuleName({ prefix: 'Hello' }, name)),
});
