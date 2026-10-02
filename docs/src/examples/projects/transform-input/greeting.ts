import { MetadataModule } from './factory';

export const Greeting = MetadataModule()('Greeting', ({ prefix, Module }) => ({
  Say: (name: string) => `${String(Module.name)}: ${prefix}, ${name}!`,
}));
export type GreetingLive = typeof Greeting.Live;
