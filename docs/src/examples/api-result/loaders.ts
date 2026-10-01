import { ApiModule } from './api-module';
import type { Api } from './api-types';

export const User = ApiModule<{ api: Api }>()('User', ({ api }) => ({
  Load: async () => api.getUser(),
}));
export type UserLive = typeof User.Live;

export const Orders = ApiModule<{ api: Api }>()('Orders', ({ api }) => ({
  Load: async () => api.getOrders(),
}));
export type OrdersLive = typeof Orders.Live;
