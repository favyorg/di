import { Module } from '../../../../../di/src';

export const User = Module<{ name: string }>()('User', ({ name }) => ({
  Load: async () => ({ name }),
}));
export type UserLive = typeof User.Live;
