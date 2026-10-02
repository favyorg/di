import { GenModule } from '../../../../../di/src';
import { User, Orders } from '../../generator/contracts';

export const Main = GenModule()('Main', function* () {
  const user = yield* User;
  const orders = yield* Orders;

  return {
    async Load() {
      const profile = await user.Load();
      const purchases = await orders.Load();
      return { user: profile.name, orderCount: purchases.length };
    },
  };
});
export type MainLive = typeof Main.Live;
