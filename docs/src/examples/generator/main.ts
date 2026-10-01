import { GenModule } from '../../../../di/src';
import { User, Orders } from './contracts';

export const Main = GenModule()('Main', function* () {
  const user = yield* User;
  const orders = yield* Orders;

  return {
    async Run() {
      console.log((await user.Load()).name);
      console.log((await orders.Load()).length);
    },
  };
});
export type MainLive = typeof Main.Live;
