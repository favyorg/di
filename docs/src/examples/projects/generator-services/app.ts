import { Main } from './main';
import { HtmlFormatter, PlainTextFormatter } from './formatters';
import type { RenderedDocument } from './types';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
root.innerHTML = `
  <main class="page">
    <span class="eyebrow">Replaceable services · Tag + GenModule</span>
    <h1>One document, two formats</h1>
    <p class="lead">Write a note and switch its formatter. Main only knows the Formatter contract.</p>
    <div class="document-fields">
      <label class="field" for="document-title"><span class="label">Title</span><input id="document-title" value="Release notes" placeholder="Document title" /></label>
      <label class="field" for="document-body"><span class="label">Body · blank lines separate paragraphs</span><textarea id="document-body" placeholder="Write your document…">The playground now supports multiple files.

Choose a formatter, edit this text, and export the result.</textarea></label>
    </div>
    <fieldset class="format-options">
      <legend class="label">Formatter implementation</legend>
      <label><input type="radio" name="format" value="html" checked /> HTML</label>
      <label><input type="radio" name="format" value="text" /> Plain text</label>
    </fieldset>
    <p id="format-error" class="error" role="alert" hidden></p>
    <section class="card" aria-label="Formatted document">
      <div id="document-preview" class="document-preview"></div>
    </section>
    <details class="source-view">
      <summary>Generated source</summary>
      <pre class="code" id="generated-source"></pre>
    </details>
    <div class="document-actions">
      <p class="status" id="format-status" role="status"></p>
      <button class="button" id="download">Download document</button>
    </div>
  </main>`;

const title = root.querySelector<HTMLInputElement>('#document-title')!;
const body = root.querySelector<HTMLTextAreaElement>('#document-body')!;
const preview = root.querySelector<HTMLElement>('#document-preview')!;
const source = root.querySelector<HTMLElement>('#generated-source')!;
const status = root.querySelector<HTMLElement>('#format-status')!;
const error = root.querySelector<HTMLElement>('#format-error')!;
const download = root.querySelector<HTMLButtonElement>('#download')!;
let rendered: RenderedDocument | undefined;

function render() {
  const format = root!.querySelector<HTMLInputElement>(
    'input[name="format"]:checked'
  )!.value;
  const main = Main({
    Formatter: format === 'html' ? HtmlFormatter : PlainTextFormatter,
  });
  try {
    rendered = main.Render({ title: title.value, body: body.value });
    if (rendered.format === 'html') {
      // HtmlFormatter escapes the document before adding its own markup.
      preview.innerHTML = rendered.content;
    } else {
      const text = document.createElement('pre');
      text.className = 'code';
      text.textContent = rendered.content;
      preview.replaceChildren(text);
    }
    source.textContent = rendered.content;
    status.textContent = `${rendered.mime} · ${
      new TextEncoder().encode(rendered.content).length
    } bytes`;
    download.textContent = `Download .${rendered.extension}`;
    download.disabled = false;
    error.hidden = true;
  } catch (cause) {
    rendered = undefined;
    preview.replaceChildren();
    source.textContent = '';
    status.textContent = '';
    download.disabled = true;
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
  }
}

title.addEventListener('input', render);
body.addEventListener('input', render);
root
  .querySelectorAll('input[name="format"]')
  .forEach((input) => input.addEventListener('change', render));
download.addEventListener('click', () => {
  if (!rendered) return;
  const content =
    rendered.format === 'html'
      ? `<!doctype html>\n<meta charset="utf-8">\n${rendered.content}`
      : rendered.content;
  const url = URL.createObjectURL(
    new Blob([content], { type: `${rendered.mime};charset=utf-8` })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `document.${rendered.extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.log(`Exported ${link.download}`, rendered.content);
});
render();
