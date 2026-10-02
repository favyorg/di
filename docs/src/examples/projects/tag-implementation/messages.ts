import { GenModule, Tag } from '../../../../../di/src';

export const Messages = Tag<{ hello: string }>()('Messages');
export type MessagesLive = typeof Messages.Live;

export const DefaultMessages = GenModule<{ prefix: string }>()(
  Messages,
  function* ({ prefix }) {
    return { hello: prefix };
  }
);
export type DefaultMessagesLive = typeof DefaultMessages.Live;
