# @favy/di documentation

The public documentation site is built with Astro and Starlight. Its source lives in `docs/src/content/docs` and is published at [di.favy.dev](https://di.favy.dev/).

## Prerequisites

- Node.js 20
- npm

## Local development

The documentation package has its own lockfile, so install and run it from this directory:

```bash
cd docs
npm ci
npm run dev
```

Astro starts the site at `http://localhost:4321` by default.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Type-check and build the production site |
| `npm run preview` | Preview the production build |
| `npm run astro -- check` | Run Astro diagnostics |

If the repository-level dependencies are installed, the equivalent Nx commands from the repository root are:

```bash
npx nx dev docs
npx nx check docs
npx nx build docs
npx nx preview docs
```

## Editing content

- Public pages are `.mdx` files under `src/content/docs`.
- The landing page is `src/content/docs/index.mdx`.
- Sidebar labels and ordering are defined in `astro.config.mjs`.
- Shared interactive examples use `src/components/editor.tsx`.
- Static files such as `llms.txt` live in `public`.

When adding a page, give it a clear `title` and `description`, add it to the sidebar, and link it from the page that naturally precedes it. Examples shown in `Editor` should be complete TypeScript rather than fragments with undeclared names.

## Verification

Before opening a pull request:

```bash
cd docs
npm run build
```

Also open the generated site and check the landing page, sidebar order, internal links, code overflow, and both light and dark themes.
