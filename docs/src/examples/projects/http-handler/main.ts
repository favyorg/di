import { Module } from '../../../../../di/src';
import type { LinkStoreLive } from './store';

export const Main = Module<LinkStoreLive>()('Main', ({ LinkStore }) => {
  return {
    async Handle(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      const allow = pathname === '/links' ? 'GET, POST' : 'GET';
      if (!allow.split(', ').includes(request.method)) {
        return Response.json(
          { error: 'Method not allowed' },
          {
            status: 405,
            headers: { Allow: allow },
          }
        );
      }
      if (pathname === '/links' && request.method === 'POST') {
        let url: URL;
        try {
          const body: unknown = await request.json();
          if (
            !body ||
            typeof body !== 'object' ||
            !('url' in body) ||
            typeof body.url !== 'string'
          )
            throw new Error('Missing URL');
          url = new URL(body.url);
          if (!['http:', 'https:'].includes(url.protocol))
            throw new Error('Unsupported URL');
        } catch {
          return Response.json(
            { error: 'Enter an absolute HTTP or HTTPS URL.' },
            { status: 400 }
          );
        }
        return Response.json(LinkStore.Create(url.href), { status: 201 });
      }
      if (pathname === '/links') return Response.json(LinkStore.List());

      const code = /^\/s\/([a-z0-9]+)$/.exec(pathname)?.[1];
      const link = code ? LinkStore.Visit(code) : undefined;
      return link
        ? new Response(null, { status: 302, headers: { Location: link.url } })
        : Response.json({ error: 'Short link not found' }, { status: 404 });
    },
  };
});
export type MainLive = typeof Main.Live;
