import { Module } from '../../../../../di/src';
import { ResultModule } from './factory';

export type Api = { getUser(): Promise<{ name: string }> };

export const User = ResultModule<{ api: Api }>()('User', ({ api }) => ({
  Load: async () => api.getUser(),
}));
export type UserLive = typeof User.Live;

export const Main = Module<UserLive>()('Main', async ({ User }) => {
  const result = await User.Load();
  if (result.ok) {
    console.log(result.value.name);
  } else {
    console.log(
      result.error instanceof Error ? result.error.message : 'Unknown error'
    );
  }
});
export type MainLive = typeof Main.Live;
