import { Main } from './main';
import { UserImpl, OrdersImpl } from '../../generator/loaders';
import type { Api } from '../../api-result/api-types';
import '../shared/styles.css';

const api: Api = {
  getUser: async () => ({ id: 1, name: 'Alex' }),
  getOrders: async () => [{ id: 10, total: 49 }],
};

const main = Main({
  User: UserImpl.provide({ api }),
  Orders: OrdersImpl.provide({ api }),
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
root.innerHTML = `
  <main class="page">
    <span class="eyebrow">Tag + GenModule</span>
    <h1>Compose generator services</h1>
    <p class="lead">Main requests service contracts with yield*. The application chooses their implementations.</p>
    <div class="toolbar"><button class="button" id="load">Load services</button></div>
    <section class="card" aria-label="Service result">
      <h2 id="load-status" role="status">Ready</h2>
      <pre class="code" id="result"></pre>
    </section>
    <p class="note">Change the API values in app.ts or provide another implementation. Main only knows the User and Orders tags.</p>
  </main>`;

const button = root.querySelector<HTMLButtonElement>('#load')!;
const status = root.querySelector<HTMLElement>('#load-status')!;
const output = root.querySelector<HTMLElement>('#result')!;

async function load() {
  button.disabled = true;
  status.textContent = 'Loading…';
  try {
    const result = await main.Load();
    output.textContent = JSON.stringify(result, null, 2);
    status.textContent = 'Services resolved';
    console.log('Main.Load():', result);
  } catch (error) {
    status.textContent = 'Load failed';
    output.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
}

button.addEventListener('click', () => void load());
void load();
