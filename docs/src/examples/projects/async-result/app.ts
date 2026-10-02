import { Main, User, type Api } from './main';

const api: Api = {
  getUser: async () => ({ name: 'Alex' }),
};

void Main({ api, User }); // Alex
