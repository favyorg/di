import {
  SandpackConsole,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from '@codesandbox/sandpack-react';
import { useEffect, useState } from 'react';
import { favyDiSourceFiles } from './favy-di-sources';

export type ProjectPreviewProps = Readonly<{
  files: Readonly<Record<string, string>>;
  entry: string;
  kind: 'frontend' | 'backend' | 'console';
  dependencies: Readonly<Record<string, string>>;
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

const previewLabels = {
  frontend: 'App preview',
  backend: 'HTTP handler preview',
  console: 'Example preview',
} as const;

const themeMessage = 'favy-project-theme';
const readyMessage = 'favy-project-theme-ready';

function themedHtml(html: string, theme: ProjectPreviewProps['theme']): string {
  const bridge = `<script>(() => {
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
  kind,
  dependencies,
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
      dependencies: Object.fromEntries(
        Object.entries(dependencies).filter(([name]) => name !== '@favy/di')
      ),
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
      <section
        className="project-preview__result"
        aria-label={previewLabels[kind]}
      >
        <h3 className="project-preview__heading">{previewLabels[kind]}</h3>
        <SandpackPreview
          className="project-preview__frame"
          showNavigator={false}
          showOpenInCodeSandbox={false}
          showRefreshButton={false}
          showRestartButton={false}
          showSandpackErrorOverlay
        />
      </section>
      <section
        className="project-preview__console"
        aria-label="Project console"
      >
        <h3 className="project-preview__heading">Console</h3>
        <SandpackConsole
          className="project-preview__logs"
          showHeader
          showSyntaxError
          showRestartButton={false}
          showResetConsoleButton
          maxMessageCount={200}
          resetOnPreviewRestart
        />
      </section>
    </SandpackProvider>
  );
}
