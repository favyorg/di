import { Module } from '../../../../di/src';
import type { UserLive, OrdersLive } from './loaders';

export const Main = Module<UserLive & OrdersLive>()('Main', async ($) => {
  const user = await $.User.Load();
  if (!user.ok) {
    if (user.error instanceof Error) console.log(user.error.message);
    return;
  }
  console.log(user.value.name); // Alex: value is UserData

  const orders = await $.Orders.Load();
  if (orders.ok) console.log(orders.value.length); // 1: value is Order[]
});
export type MainLive = typeof Main.Live;
