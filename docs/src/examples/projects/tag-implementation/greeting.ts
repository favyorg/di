import { GenModule } from '../../../../../di/src';
import { Messages } from './messages';

export const Greeting = GenModule()('Greeting', function* () {
  const messages = yield* Messages;
  return `${messages.hello}, Alex!`;
});
export type GreetingLive = typeof Greeting.Live;
