import {
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from '@codesandbox/sandpack-react';
import { useEffect, useState } from 'react';
import { favyDiSourceFiles } from './favy-di-sources';

export type ProjectPreviewProps = Readonly<{
  files: Readonly<Record<string, string>>;
  entry: string;
  theme: 'light' | 'dark';
}>;

const previewOptions = {
  autorun: true,
  autoReload: false,
  initMode: 'immediate',
} as const;

const viteConfig = `export default {
  resolve: {
    alias: [{ find: /^@favy\\/di$/, replacement: '/favy-di/index.ts' }],
  },
  esbuild: { jsx: 'automatic' },
  server: { cors: { origin: '*' }, hmr: false },
};`;

const themeMessage = 'favy-project-theme';
const readyMessage = 'favy-project-theme-ready';

function themedHtml(html: string, theme: ProjectPreviewProps['theme']): string {
  const bridge = `<style>
    :root { color-scheme: light; color: #111827; background: #ffffff; }
    :root[data-theme='dark'] { color-scheme: dark; color: #f8fafc; background: #1c2738; }
    body { margin: 24px; font: 16px/1.5 system-ui, sans-serif; }
    button { padding: 8px 12px; font: inherit; cursor: pointer; }
    output { margin-inline-start: 12px; font-variant-numeric: tabular-nums; }
  </style><script>(() => {
    const applyTheme = (theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    applyTheme(${JSON.stringify(theme)});
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (event.source === parent && message?.type === '${themeMessage}' &&
          (message.theme === 'light' || message.theme === 'dark')) {
        applyTheme(message.theme);
      }
    });
    parent.postMessage({ type: '${readyMessage}' }, '*');
  })();</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${bridge}`);
  }
  return html.replace(
    /^(<!doctype[^>]*>)?/i,
    (doctype) => `${doctype}${bridge}`
  );
}

function PreviewTheme({ theme }: Pick<ProjectPreviewProps, 'theme'>): null {
  const { sandpack } = useSandpack();

  useEffect(() => {
    const sendTheme = (frame: HTMLIFrameElement, origin: string) => {
      frame.contentWindow?.postMessage({ type: themeMessage, theme }, origin);
    };
    for (const { iframe } of Object.values(sandpack.clients)) {
      const origin = new URL(iframe.src || 'about:blank').origin;
      sendTheme(iframe, origin === 'null' ? '*' : origin);
    }
    const onReady = (event: MessageEvent) => {
      if (event.data?.type !== readyMessage) return;
      const client = Object.values(sandpack.clients).find(
        ({ iframe }) => iframe.contentWindow === event.source
      );
      if (client) {
        sendTheme(client.iframe, event.origin === 'null' ? '*' : event.origin);
      }
    };
    window.addEventListener('message', onReady);
    return () => window.removeEventListener('message', onReady);
  }, [sandpack.clients, theme]);

  return null;
}

// A mounted instance owns one Run snapshot. The parent unmounts it for Stop,
// Reset, example navigation, and before starting another Run.
export function ProjectPreview({
  files,
  entry,
  theme,
}: ProjectPreviewProps): JSX.Element {
  const [project] = useState(() => ({
    files: {
      ...files,
      '/index.html': themedHtml(files['/index.html'], theme),
      ...Object.fromEntries(
        favyDiSourceFiles.map(({ sandboxPath, code }) => [
          sandboxPath,
          { code, hidden: true },
        ])
      ),
      '/vite.config.js': { code: viteConfig, hidden: true },
    },
    customSetup: {
      entry,
      // The template's esbuild 0.17.12 cannot parse our const generics.
      devDependencies: { 'esbuild-wasm': '0.17.19' },
    },
  }));

  return (
    <SandpackProvider
      className="project-preview"
      template="vite"
      files={project.files}
      customSetup={project.customSetup}
      options={previewOptions}
      theme={theme}
    >
      <PreviewTheme theme={theme} />
      <section className="project-preview__result" aria-label="App preview">
        <h3 className="project-preview__heading">App preview</h3>
        <SandpackPreview
          className="project-preview__frame"
          showNavigator={false}
          showOpenInCodeSandbox={false}
          showOpenNewtab={false}
          showRefreshButton={false}
          showRestartButton={false}
          showSandpackErrorOverlay
        />
      </section>
    </SandpackProvider>
  );
}
