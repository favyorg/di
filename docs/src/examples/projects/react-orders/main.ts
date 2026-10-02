import { GenModule } from '../../../../../di/src';
import { Orders, User } from './contracts';

export const Main = GenModule()('Main', function* () {
  const user = yield* User;
  const orders = yield* Orders;

  return {
    async Load() {
      const [profile, purchases] = await Promise.all([
        user.Load(),
        orders.Load(),
      ]);
      return { user: profile, orders: purchases };
    },
  };
});
export type MainLive = typeof Main.Live;
