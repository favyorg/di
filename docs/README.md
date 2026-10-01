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

| Command                  | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Start the local development server          |
| `npm run build`          | Type-check and build the production site    |
| `npm run preview`        | Preview the production build                |
| `npm run astro -- check` | Run Astro diagnostics                       |
| `npm test`               | Run documentation and playground unit tests |
| `npm run test:browser`   | Run all documentation browser checks        |
| `npm run smoke`          | Check pages and the standalone playground   |
| `npm run test:editor`    | Check editor browser regressions            |
| `npm run test:pages`     | Check documentation pages and navigation    |
| `npm run test:home`      | Check the homepage, Copy, and Run           |

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

Declare each module's dependency type as `type NameLive = typeof Name.Live` immediately below the module, and export it when the module is exported. Reuse that alias in consuming modules; keep result types inferred from the implementation. `.Live` is a type-only marker; accessing it at runtime throws. The exported `Live<T>` helper remains available for generic type utilities. Interfaces for external inputs and domain data remain explicit.

For larger examples, pass a non-empty `files` array instead of `code`. Each entry has a unique relative TypeScript filename (such as `name: 'api-module.ts'`) and its `code`. The first file opens by default. Each widget gives its files unique model paths. Use `import` and `export` to connect them: relative imports, diagnostics, and F12 navigation work across tabs; edits, undo history, and cursor/scroll positions survive switching tabs. Without JavaScript, each file is available in a native expandable code block.

Keep these examples as real `.ts` files under `src/examples` and import their content with `?raw` in MDX. This preserves formatting and includes the examples in the documentation's TypeScript check. See `module/transform-output.mdx` and `src/examples/api-result` for a complete example, including the local DI import's replacement with the public `@favy/di` package name in the displayed code.

Set `entry="app.ts"` on a multi-file `Editor` to enable Run, using the filename that starts the example. In the API result example, `main.ts` exports the application module and its type; `app.ts` supplies mocks and starts it. Each run type-checks and compiles a snapshot of all current tabs, then executes the entry file with fresh module state. The console shows logs and compilation/runtime errors; Stop cancels compilation or execution. Relative example imports and the repository's current `@favy/di` implementation are available. Execution is isolated from the page, with no DOM, browser storage, network access, or additional packages. Use `async` functions for asynchronous work; top-level `await` is not supported. Execution stops after 5 seconds and caps console output at 100 messages or 64,000 characters, with up to 4,000 characters per message.

## Verification

Before opening a pull request:

```bash
cd docs
npx playwright install chromium
npm test
npm run build
npm run test:browser
```

The editor and homepage browser suites start their own production previews on free localhost ports. The page/playground smoke runner starts a preview on port 4399 by default; override it with `DOCS_SMOKE_PORT`. Each runner stops its preview after the run, including failed runs. Browser checks use Playwright's installed Chromium by default and require an existing production build. `npm test` runs Jest without requiring a build.

- `test:editor` checks the real `@favy/di` TypeScript integration, autocomplete, hover, parameter hints, document scrolling, resizing, typing, keyboard navigation, and cleanup in both themes at desktop and mobile widths. It also covers file tabs, cross-file diagnostics, preserved edits and undo, F12 navigation, and access to all files without JavaScript. Run checks include edited multi-file execution, repeat runs, compilation/runtime errors, async logs, keyboard controls, Stop, timeout, safe text output, blocked network access, and worker cleanup on unmount.
- `test:pages` runs `smoke`, checking API anchors, content layout, mobile navigation, contrast, the editor fallback without JavaScript, and the standalone playground's editor and execution lifecycle.
- `test:home` checks navigation, Copy, responsive layout, and the `greeting.ts` Run button. Fixed browser time makes initial and repeated execution deterministic, including Enter and Space, in both themes at 1440, 390, and 320 px. It also checks the fallback without JavaScript.

From the repository root, `npx nx test docs` runs the Jest suite, and `npx nx run docs:browser` builds the documentation before running all browser suites. GitHub Actions runs the unit checks, documentation build, page/playground smoke checks, and editor/homepage browser checks. Install the documentation dependencies and the Playwright Chromium browser before running browser checks. Linux CI environments can use `npx playwright install --with-deps chromium` from `docs`.

Optional overrides:

```bash
# Test an already running production preview; the suite leaves it running.
DOCS_URL=http://127.0.0.1:4321 npm run test:browser

# Use an installed Chrome browser instead of Playwright's Chromium.
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

The overrides can be combined and apply to each individual suite as well.

Also open the generated site and check the landing page, sidebar order, internal links, code overflow, and both light and dark themes.
