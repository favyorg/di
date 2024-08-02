import { Module } from '@favy/di';

type RequestArgs = { BASE_URL: string; fetch: typeof fetch };

export const Request = Module<RequestArgs>()(
  'Request',
  ({ fetch, BASE_URL }) => {
    return {
      get: (url: string) => fetch(BASE_URL + url).then((d) => d.json()),

      post: (url: string, data: any) =>
        fetch(BASE_URL + url, {
          method: 'POST',
          body: JSON.stringify(data),
        }).then((d) => d.json()),

      delete: (url: string) =>
        fetch(BASE_URL + url, {
          method: 'DELETE',
        }).then((d) => d.json()),
    };
  }
);

export type RequestLive = typeof Request.Live;
