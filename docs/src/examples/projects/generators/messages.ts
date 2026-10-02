import { GenModule, Tag } from '../../../../../di/src';

export const Messages = Tag<{ hello: string }>()('Messages');

export const DefaultMessages = GenModule()(Messages, function* () {
  return { hello: 'Hello' };
});
