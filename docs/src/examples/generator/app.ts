import { Main } from './main';
import { User, Orders } from './loaders';
import type { Api } from '../api-result/api-types';

const api: Api = {
  getUser: async () => ({ id: 1, name: 'Alex' }),
  getOrders: async () => [{ id: 10, total: 49 }],
};

void Main({ api, User, Orders }).Run(); // Alex, 1
