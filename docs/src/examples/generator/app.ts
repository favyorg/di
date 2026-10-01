import { Main } from './main';
import { UserImpl, OrdersImpl } from './loaders';
import type { Api } from '../api-result/api-types';

const api: Api = {
  getUser: async () => ({ id: 1, name: 'Alex' }),
  getOrders: async () => [{ id: 10, total: 49 }],
};

void Main({
  User: UserImpl.provide({ api }),
  Orders: OrdersImpl.provide({ api }),
}).Run(); // Alex, 1
