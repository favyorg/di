import { Module } from '@favy/di';
import { PostsLive } from './Posts.module';

export const App = Module<PostsLive>()('App', ({ Posts }) => {
  return () => {
    return (
      <div>
        <h1>Posts</h1>
        <Posts />
      </div>
    );
  };
});
