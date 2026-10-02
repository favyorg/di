import { createRoot } from 'react-dom/client';
import { Dashboard } from './dashboard';
import { Main } from './main';
import { OrdersImpl, UserImpl } from './services';
import type { Api } from './api-types';
import '../shared/styles.css';

let unavailable = false;
const api: Api = {
  getUser: async () => ({ id: 1, name: 'Alex' }),
  async getOrders() {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (unavailable)
      throw new Error('Orders API unavailable. Try Reload orders.');
    return [
      { id: 10, total: 49 },
      { id: 11, total: 24 },
    ];
  },
};

const main = Main({
  User: UserImpl.provide({ api }),
  Orders: OrdersImpl.provide({ api }),
});

async function load(fail: boolean) {
  unavailable = fail;
  const result = await main.Load();
  console.log('Loaded dashboard:', result);
  return result;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<Dashboard load={load} />);
