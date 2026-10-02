import { Module } from '../../../../../di/src';
import type { UserLive } from './user';

export const Handler = Module<UserLive>()('Handler', ({ User }) => ({
  Handle: async (request: Request) => {
    const user = await User.Load();
    return Response.json({ path: new URL(request.url).pathname, user });
  },
}));
export type HandlerLive = typeof Handler.Live;
