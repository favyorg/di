import { GenModule } from '../../../../../di/src';
import type { Api } from './api-types';
import { Orders, User } from './contracts';

export const UserImpl = GenModule<{ api: Api }>()(User, function* ({ api }) {
  return { Load: async () => api.getUser() };
});
export type UserImplLive = typeof UserImpl.Live;

export const OrdersImpl = GenModule<{ api: Api }>()(
  Orders,
  function* ({ api }) {
    return { Load: async () => api.getOrders() };
  }
);
export type OrdersImplLive = typeof OrdersImpl.Live;
