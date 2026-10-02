import { Module } from '../../../../../di/src';

export const Messages = Module()('Messages', () => ({ hello: 'Hello' }));
export type MessagesLive = typeof Messages.Live;
