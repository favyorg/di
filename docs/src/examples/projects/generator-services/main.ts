import { GenModule } from '../../../../../di/src';
import { Formatter } from './contracts';
import type { Document } from './types';

export const Main = GenModule()('Main', function* () {
  const formatter = yield* Formatter;

  return {
    Render(document: Document) {
      const title = document.title.trim();
      const body = document.body.replace(/\r\n?/g, '\n').trim();
      if (!title || !body) throw new Error('Add a title and some text.');
      return formatter.Render({ title, body });
    },
  };
});
export type MainLive = typeof Main.Live;
