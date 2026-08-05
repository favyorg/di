# Standalone Playground Design

**Date:** 2026-08-05
**Status:** Approved for planning

## Goal

Move the interactive playground out of the documentation content layout while
keeping it at `https://di.favy.dev/playground/`. The editor should feel like a
focused tool, not a long-form documentation article.

## Scope

- Replace the Starlight MDX playground document with a custom Astro route.
- Keep the existing React playground, examples, dependency loading, runtime,
  type hover, and run behavior.
- Keep a Playground link in the documentation navigation, but make it a direct
  link to the standalone route.
- Remove the explicit `ReturnType<typeof Clock>` annotation from `FixedClock`
  so the replacement example demonstrates normal TypeScript inference.

This change does not create a second application or deployment and does not
redesign the runtime protocol.

## Page Architecture

`docs/src/pages/playground.astro` owns the `/playground/` route. It renders a
complete HTML document with page metadata, a compact product header, and the
existing `<Playground client:load />` component. The current
`docs/src/content/docs/playground.mdx` route is removed so there is only one
route owner.

The standalone page does not render Starlight's documentation sidebar, table of
contents, article title, pagination, or footer. Its header contains:

- the `@favy/di` brand linking to the homepage;
- a link back to the documentation introduction;
- a GitHub link;
- an accessible light/dark theme control.

The page uses the same `starlight-theme` preference as the documentation and
sets `data-theme` before paint to avoid a theme flash. Page-level styles provide
the small shared color and spacing token set required by the playground instead
of relying on Starlight article selectors.

## Layout and Responsive Behavior

On desktop, the header stays compact and the playground uses the remaining
viewport width. The existing example selector remains in the left column and
the editor/console workspace remains on the right. The standalone shell removes
the article width cap and the extra prose margins.

On narrow screens, the existing select-based example picker remains in use and
the editor and console stack as they do today. The header links remain keyboard
reachable and may wrap without overlapping the playground.

## Navigation and Metadata

The Starlight sidebar entry changes from a content `slug` to a direct internal
link to `/playground/`. Existing links in `llms.txt` and the docs continue to
resolve without redirects. The custom route includes a canonical URL, title,
description, viewport metadata, and the existing site favicon.

## Behavior and Error Handling

Moving the route must not reset drafts while a user stays on the page, alter
the one-second import detection delay, change Run behavior, or change type
hover. Existing loading and runtime errors remain inside the playground rather
than affecting the standalone shell.

The `FixedClock` example becomes:

```ts
const FixedClock = {
  now: () => '2000-01-01T00:00:00.000Z',
};
```

TypeScript infers the object shape and the call to `Timestamp` remains the point
where compatibility with the `Clock` dependency is checked.

## Verification

- A build contains exactly one `/playground/` page and no route collision.
- The docs navigation link opens the standalone page.
- The standalone page has no docs sidebar, TOC, pagination, or article chrome.
- Desktop and mobile layouts remain usable in light and dark themes.
- Keyboard navigation and accessible names cover the header, theme control,
  editor, example picker, Run button, and console.
- Type hover works and all bundled examples execute with their expected output.
- Existing dependency-resolution, runtime, and docs smoke tests remain green.

## Non-goals

- A separate domain, package, deployment, or build pipeline.
- A redesign of the editor, example navigation, or console.
- Changes to dependency resolution or sandbox execution semantics.
