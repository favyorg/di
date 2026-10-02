import { Tag } from '../../../../../di/src';

export const Messages = Tag<{ hello: string }>()('Messages');
export type MessagesLive = typeof Messages.Live;
