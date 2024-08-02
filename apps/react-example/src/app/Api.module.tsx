import { Module } from '@favy/di';
import { RequestLive } from './Request.module';

export const Api = Module<RequestLive>()('Api', ($) => {
  return {
    getPosts() {
      return $.Request.get('/posts');
    },
    deletePost(id: number) {
      return $.Request.delete('/posts/' + id);
    },
  };
});

export type ApiLive = typeof Api.Live;
