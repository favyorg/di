import { GenModule } from '../../../../../di/src';
import { Messages } from './messages';

export const Greeting = GenModule()('Greeting', function* () {
  const messages = yield* Messages;
  return { Say: (name: string) => `${messages.hello}, ${name}!` };
});
