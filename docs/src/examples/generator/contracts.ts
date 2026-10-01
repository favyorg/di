import { Tag } from '../../../../di/src';
import type { UserData, Order } from '../api-result/api-types';

export const User = Tag<{
  Load(): Promise<UserData>;
}>()('User');
export type UserLive = typeof User.Live;

export const Orders = Tag<{
  Load(): Promise<Order[]>;
}>()('Orders');
export type OrdersLive = typeof Orders.Live;
