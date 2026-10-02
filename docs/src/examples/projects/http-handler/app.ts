import { Main } from './main';
import { UserRepositoryImpl } from './repository';
import { users } from './mock-data';
import '../shared/styles.css';

const main = Main({
  UserRepository: UserRepositoryImpl.provide({ users }),
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
root.innerHTML = `
  <main class="page">
    <span class="eyebrow">Browser backend</span>
    <h1>HTTP request handler</h1>
    <p class="lead">Send a Request to a handler backed by an injected repository. Everything runs here in the browser.</p>
    <form class="toolbar request" id="request-form">
      <label class="field" for="request-path"><span class="label">GET path</span><input id="request-path" value="/users/1" placeholder="/users/1" required /></label>
      <button class="button" type="submit">Send request</button>
    </form>
    <div class="toolbar">
      <button class="button secondary" data-path="/users/1">User 1</button>
      <button class="button secondary" data-path="/users/2">User 2</button>
      <button class="button secondary" data-path="/users/404">Missing user</button>
    </div>
    <section class="card" aria-label="HTTP response">
      <h2 id="response-status" role="status">Ready</h2>
      <pre class="code" id="response-body"></pre>
    </section>
    <p class="note">Try /users/404 for a 404 response. Edit mock-data.ts to change the repository data.</p>
  </main>`;

const form = root.querySelector<HTMLFormElement>('#request-form')!;
const path = root.querySelector<HTMLInputElement>('#request-path')!;
const status = root.querySelector<HTMLElement>('#response-status')!;
const body = root.querySelector<HTMLElement>('#response-body')!;

async function send() {
  try {
    const request = new Request(new URL(path.value, 'https://example.test'));
    const response = await main.Handle(request);
    const result: unknown = await response.json();
    status.textContent = `GET ${new URL(request.url).pathname} → ${
      response.status
    }`;
    body.textContent = JSON.stringify(result, null, 2);
    console.log(response.status, result);
  } catch (error) {
    status.textContent = 'Request failed';
    body.textContent = error instanceof Error ? error.message : String(error);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void send();
});
root.querySelectorAll<HTMLButtonElement>('[data-path]').forEach((button) => {
  button.addEventListener('click', () => {
    path.value = button.dataset.path!;
    void send();
  });
});
void send();
