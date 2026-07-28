# Homepage Redesign

## Context

The current homepage uses Starlight's default splash hero followed by plain
Markdown sections. The large JPEG logo does not match the library's technical
positioning, the quick-start code clips on narrow screens, and the lower half
of the page reads as an unstructured list rather than a useful path into the
documentation.

The redesign should make the library's main idea understandable at a glance:
dependency graphs are built from ordinary typed functions, without decorators,
reflection, or container ceremony.

## Goals

- Communicate the library's purpose within the first screen.
- Make real code and the dependency graph the primary visual proof.
- Give new readers a clear path from installation to the relevant guide.
- Preserve every important destination currently linked from the homepage.
- Work cleanly on small screens and in both Starlight color themes.
- Keep the homepage lightweight and isolated from the rest of the docs.

## Non-goals

- Do not redesign the shared Starlight header, sidebar, or documentation pages.
- Do not change the library API or examples outside the homepage.
- Do not repair the existing Starlight theme integration as part of this work.
- Do not load Monaco or another full editor on the homepage.
- Do not add an image asset, animation library, or UI dependency.

## Component Architecture

`docs/src/content/docs/index.mdx` will retain the page metadata and
`template: splash`, but its default Starlight hero configuration and Markdown
body will be replaced with a single imported homepage component.

`docs/src/components/home.astro` will own the homepage markup, its scoped CSS,
and the small copy-to-clipboard enhancement. Keeping these concerns together
makes the design easy to review and prevents homepage rules from affecting
other documentation pages.

The shared Starlight shell remains intact. No layout override or global CSS
change is required.

## Page Structure

### 1. Hero workbench

The hero is a contained dark technical surface with a subtle grid and restrained
violet/cyan glow. It contains:

- a small `v3 · TypeScript-first DI` eyebrow;
- the headline `Dependency graphs, just typed functions.`;
- concise copy explaining explicit dependencies, replaceable boundaries, and
  the absence of decorators and reflection;
- primary `Get started` and secondary `API reference` actions;
- an install command with an accessible copy button;
- a static, syntax-highlighted quick-start example;
- a compact dependency graph that connects the modules shown in the example.

The code and graph replace the current decorative JPEG logo.

### 2. Proof strip

Four compact proof points summarize the design:

- zero decorators;
- typed end to end;
- lazy by default;
- replaceable boundaries.

These are factual capability summaries, not invented performance statistics.

### 3. Quick-start explanation

A short section explains the three steps visible in the hero example:

1. define a dependency as a module;
2. describe the consumer through `Live<typeof Dependency>`;
3. supply the implementation at the graph boundary.

The explanation links to the Introduction and core Module guide rather than
duplicating their full content.

### 4. Capability grid

Focused cards cover:

- explicit typed graphs;
- cache lifetimes;
- lazy resolution;
- partial application and dependency replacement;
- testing boundaries;
- transform input/output for advanced use cases.

Each card has one short explanation and a direct link to its relevant guide.

### 5. Learning paths

Four larger navigation cards group the documentation by reader intent:

- Start — Introduction and Module;
- Build — Caching, Lazy, and Partial Application;
- Test — Testing and Best Practices;
- Extend — Transform Input, Transform Output, and API Reference.

### 6. Final action

A restrained closing panel offers two clear destinations: continue into the
Introduction or inspect the source on GitHub.

## Visual System

The hero uses a deliberately dark workbench surface in both color themes.
Everything below it follows Starlight's current theme through `--sl-*` tokens,
so light and dark modes remain native to the docs.

Typography uses the existing site fonts. Hierarchy comes from scale, weight,
spacing, and max-width rather than an additional font. Violet is the primary
accent; cyan is used sparingly for graph connections and small code details.
Borders remain thin and low contrast, with modest corner radii.

The page avoids decorative imagery. A lightweight inline SVG or semantic
HTML/CSS graph is acceptable because it directly explains the code.

## Responsive Behavior

- The hero is two columns on wide screens and one column on narrow screens.
- Text and actions appear before code on mobile.
- Proof points and cards progressively collapse to two and then one column.
- Code scrolls inside its own panel when necessary; the page itself never
  creates horizontal overflow.
- Action groups wrap rather than shrink below comfortable tap sizes.
- The design remains usable from a 320 px viewport upward.

## Interaction and Accessibility

- All navigation remains ordinary links and works without JavaScript.
- Copy buttons enhance the static install and code blocks without making them
  dependent on JavaScript.
- A successful copy updates an `aria-live` label and then restores the original
  label.
- Interactive controls have visible keyboard focus and at least a 44 px tap
  target where practical.
- Decorative graph elements are hidden from assistive technology; equivalent
  relationships are stated in the surrounding text.
- Color is never the only indicator of meaning.
- Motion is limited to short hover/focus transitions and is disabled under
  `prefers-reduced-motion`.

## Content Constraints

- Use the public `@favy/di` API exactly as documented in the repository.
- Keep the main code example compact enough to understand without scrolling on
  a typical desktop viewport.
- Avoid unverified claims such as bundle-size, compile-time, or benchmark
  numbers.
- Preserve links to Introduction, Module, Caching, Lazy, Partial Application,
  Testing, Best Practices, Transform Input, Transform Output, API Reference,
  and GitHub.

## Validation

1. Format the changed Astro and MDX files.
2. Run `npx nx run docs:check --skip-nx-cache`.
3. Run `npx nx run docs:build --skip-nx-cache`.
4. Inspect the homepage at desktop and mobile widths.
5. Inspect both light and dark themes.
6. Verify there is no page-level horizontal overflow at 320 px.
7. Verify navigation links and copy controls.
8. Check keyboard focus, reduced-motion behavior, console errors, and obvious
   contrast issues.

## Acceptance Criteria

- The old JPEG hero logo is absent from the homepage.
- The first screen states what the library does and shows a real typed graph.
- The homepage uses a static code block and does not load Monaco.
- Every current documentation destination remains reachable.
- The Starlight shell and all non-homepage pages remain visually unchanged.
- The homepage has no horizontal clipping at 320 px.
- Light mode, dark mode, keyboard navigation, and copy controls work.
- Documentation type checking and production build pass.
