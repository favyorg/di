import { Main } from './main';
import { LinkStore } from './store';
import type { ShortLink } from './types';
import './styles.css';

// One application instance keeps the injected store alive across requests.
const main = Main({ LinkStore });
const origin = 'https://short.example';
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
root.innerHTML = `
  <main class="page">
    <span class="eyebrow">Stateful HTTP API · Module</span>
    <h1>Make a short link</h1>
    <p class="lead">Create a link, follow its redirect, and watch its visit count grow.</p>
    <form class="toolbar request" id="create-link">
      <label class="field" for="destination"><span class="label">Destination URL</span><input id="destination" inputmode="url" value="https://example.com/a/long/article" placeholder="https://example.com/article" required /></label>
      <button class="button" type="submit">Shorten URL</button>
    </form>
    <h2>Your links</h2>
    <ul class="link-list" id="links" aria-label="Short links"></ul>
    <p class="empty-links" id="empty-links">No links yet. Create your first one above.</p>
    <section class="card" aria-label="HTTP exchange">
      <h2 class="response-status" id="response-status" role="status">Ready for POST /links</h2>
      <pre class="code" id="response-body">Requests run locally. Redirects appear here.</pre>
    </section>
    <button class="button secondary" id="missing-link">Try a missing link</button>
    <p class="note">POST creates a link; GET /s/:code returns 302 and increments visits. Run again to start with an empty store.</p>
  </main>`;

const form = root.querySelector<HTMLFormElement>('#create-link')!;
const destination = root.querySelector<HTMLInputElement>('#destination')!;
const list = root.querySelector<HTMLUListElement>('#links')!;
const empty = root.querySelector<HTMLElement>('#empty-links')!;
const status = root.querySelector<HTMLElement>('#response-status')!;
const body = root.querySelector<HTMLElement>('#response-body')!;
let busy = false;

async function refreshLinks() {
  const response = await main.Handle(new Request(`${origin}/links`));
  const links: ShortLink[] = await response.json();
  list.replaceChildren();
  empty.hidden = links.length > 0;
  for (const link of links) {
    const row = document.createElement('li');
    row.className = 'link-row';
    const description = document.createElement('div');
    const shortUrl = document.createElement('strong');
    shortUrl.textContent = `/s/${link.code}`;
    const detail = document.createElement('small');
    detail.textContent = `${link.visits} ${
      link.visits === 1 ? 'visit' : 'visits'
    } · ${link.url}`;
    description.append(shortUrl, detail);
    const follow = document.createElement('button');
    follow.type = 'button';
    follow.className = 'button secondary';
    follow.textContent = 'Visit';
    follow.setAttribute('aria-label', `Visit /s/${link.code}`);
    follow.addEventListener('click', () => void send(`/s/${link.code}`));
    row.append(description, follow);
    list.append(row);
  }
}

async function send(path: string, init?: RequestInit) {
  if (busy) return;
  busy = true;
  try {
    const request = new Request(`${origin}${path}`, init);
    const response = await main.Handle(request);
    status.textContent = `${request.method} ${path} → ${response.status}`;
    const location = response.headers.get('Location');
    body.textContent = location
      ? `Location: ${location}`
      : JSON.stringify(await response.json(), null, 2);
    console.log(status.textContent, body.textContent);
    await refreshLinks();
  } catch (error) {
    status.textContent = 'Request failed';
    body.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void send('/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: destination.value }),
  });
});
root
  .querySelector('#missing-link')!
  .addEventListener('click', () => void send('/s/missing'));
