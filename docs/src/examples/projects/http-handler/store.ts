import { Module } from '../../../../../di/src';
import type { ShortLink } from './types';

export const LinkStore = Module()('LinkStore', () => {
  const links = new Map<string, ShortLink>();
  let sequence = 0;

  return {
    Create(url: string): ShortLink {
      const link = { code: (++sequence).toString(36), url, visits: 0 };
      links.set(link.code, link);
      return { ...link };
    },
    Visit(code: string): ShortLink | undefined {
      const link = links.get(code);
      if (!link) return;
      link.visits += 1;
      return { ...link };
    },
    List(): ShortLink[] {
      return [...links.values()].map((link) => ({ ...link }));
    },
  };
});
export type LinkStoreLive = typeof LinkStore.Live;
