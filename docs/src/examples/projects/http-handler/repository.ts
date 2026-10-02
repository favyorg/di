import { GenModule } from '../../../../../di/src';
import type { UserData } from './api-types';
import { UserRepository } from './contracts';

export const UserRepositoryImpl = GenModule<{ users: readonly UserData[] }>()(
  UserRepository,
  function* ({ users }) {
    return { Load: async (id: number) => users.find((user) => user.id === id) };
  }
);
export type UserRepositoryImplLive = typeof UserRepositoryImpl.Live;
