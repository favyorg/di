import { Module } from '@favy/di';
import { useEffect, useState } from 'react';
import { ApiLive } from './Api.module';
import { ButtonLive } from './Button.module';

export const Posts = Module<ApiLive & ButtonLive>()(
  'Posts',
  ({ Api, Button }) => {
    return () => {
      const [posts, setPosts] = useState<any[]>([]);
      useEffect(() => {
        Api.getPosts().then(setPosts);
      }, []);

      const deletePost = (id: number) => {
        Api.deletePost(id).then(() => {
          setPosts(posts.filter((p) => p.id !== id));
        });
      };

      return (
        <div>
          {posts.map((post) => (
            <div key={post.id}>
              <h2>{post.title}</h2>
              <p>{post.body}</p>
              <Button onClick={() => deletePost(post.id)} text="Delete" />
            </div>
          ))}
        </div>
      );
    };
  }
);

export type PostsLive = typeof Posts.Live;
