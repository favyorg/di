import { Handler } from './handler';
import { User } from './user';

const handler = Handler({ name: 'Alex', User });
const request = new Request('https://example.test/user');

void handler.Handle(request).then(async (response) => {
  console.log(response.status);
  console.log(await response.json());
});
