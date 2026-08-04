// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import rehypeMermaid from 'rehype-mermaid';
import starlightThemeRapide from 'starlight-theme-rapide';
import { preserveEditorCode } from './remark-preserve-editor-code.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://di.favy.dev',
  redirects: {
    '/module/provide/': '/module/partial/',
    '/reference/example/': '/reference/api/',
  },
  integrations: [
    starlight({
      title: '@favy/di Docs',
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', slug: 'guides/introduction' },
            { label: 'Playground', slug: 'playground' },
          ],
        },
        {
          label: 'Core concepts',
          items: [
            { label: 'Module', slug: 'module/module' },
            { label: 'Caching', slug: 'module/cache' },
            { label: 'Lazy', slug: 'module/lazy' },
            { label: 'Partial Application', slug: 'module/partial' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Testing', slug: 'guides/testing' },
            { label: 'Best Practices', slug: 'guides/best-practices' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Transform Input', slug: 'module/transform-input' },
            { label: 'Transform Output', slug: 'module/transform-output' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'API Reference', slug: 'reference/api' }],
        },
      ],
      components: {
        PageTitle: './src/components/docs-page-title.astro',
      },
      customCss: [
        '/src/tailwind.css',
        '/src/styles/docs-shell.css',
        '/src/styles/docs-content.css',
      ],
    }),
    react(),
    tailwind({
      applyBaseStyles: false,
      configFile: fileURLToPath(
        new URL('./tailwind.config.mjs', import.meta.url)
      ),
    }),
    starlightThemeRapide(),
  ],
  markdown: {
    remarkPlugins: [preserveEditorCode],
    rehypePlugins: [rehypeMermaid],
  },
  vite: {
    ssr: {
      noExternal: ['monaco-editor'],
    },
  },
});
