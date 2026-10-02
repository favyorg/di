import { Module } from '../../../../../di/src';

export const Messages = Module<{ prefix: string; locale: string }>()(
  'Messages',
  ({ prefix, locale }) => ({ hello: prefix, locale })
);
export type MessagesLive = typeof Messages.Live;
