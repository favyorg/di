import { GenModule } from '../../../../di/src';
import type { Api } from '../api-result/api-types';

export const User = GenModule<{ api: Api }>()('User', function* ({ api }) {
  return { Load: async () => api.getUser() };
});
export type UserLive = typeof User.Live;

export const Orders = GenModule<{ api: Api }>()('Orders', function* ({ api }) {
  return { Load: async () => api.getOrders() };
});
export type OrdersLive = typeof Orders.Live;
