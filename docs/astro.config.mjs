// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import rehypeMermaid from 'rehype-mermaid';
import starlightThemeRapide from 'starlight-theme-rapide';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: '@favy/di Docs',
      sidebar: [
        {
          label: 'Getting started',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Introduction', slug: 'guides/introduction' },
          ],
        },
        {
          label: 'Module',
          items: [
            { label: 'Module', slug: 'module/module' },
            { label: 'Caching', slug: 'module/cache' },
            { label: 'Lazy', slug: 'module/lazy' },
            { label: 'Transform Input', slug: 'module/transform-input' },
            { label: 'Transform Output', slug: 'module/transform-output' },
            { label: 'Partial', slug: 'module/partial' },
            { label: 'Provide', slug: 'module/provide' },
          ],
        },
        // {
        //   label: 'Reference',
        //   autogenerate: { directory: 'reference' },
        // },
      ],
      customCss: ['/src/tailwind.css'],
    }),
    react(),
    tailwind({
      applyBaseStyles: false,
    }),
    starlightThemeRapide(),
  ],
  markdown: {
    rehypePlugins: [rehypeMermaid],
  },
  vite: {
    ssr: {
      noExternal: ['monaco-editor'],
    },
  },
});
