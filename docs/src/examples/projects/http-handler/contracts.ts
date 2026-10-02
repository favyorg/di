import { Tag } from '../../../../../di/src';
import type { UserData } from './api-types';

export const UserRepository = Tag<{
  Load(id: number): Promise<UserData | undefined>;
}>()('UserRepository');
export type UserRepositoryLive = typeof UserRepository.Live;
