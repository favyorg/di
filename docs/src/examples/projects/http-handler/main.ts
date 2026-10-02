import { GenModule } from '../../../../../di/src';
import { UserRepository } from './contracts';

export const Main = GenModule()('Main', function* () {
  const users = yield* UserRepository;

  return {
    async Handle(request: Request): Promise<Response> {
      if (request.method !== 'GET') {
        return Response.json(
          { error: 'Method not allowed' },
          {
            status: 405,
            headers: { Allow: 'GET' },
          }
        );
      }
      const match = /^\/users\/(\d+)$/.exec(new URL(request.url).pathname);
      if (!match)
        return Response.json({ error: 'Route not found' }, { status: 404 });

      const user = await users.Load(Number(match[1]));
      return user
        ? Response.json(user)
        : Response.json({ error: 'User not found' }, { status: 404 });
    },
  };
});
export type MainLive = typeof Main.Live;
