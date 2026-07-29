# Documentation Pages Redesign

Date: 2026-07-28

## Goal

Bring every non-home documentation page into the same visual system as the v3
homepage while keeping the documentation technically complete, fast to
navigate, and easy to scan.

The redesign must preserve:

- all current routes and public heading anchors;
- all technical explanations, declarations, and runnable examples;
- Monaco type checking and hover information;
- light and dark themes;
- the current readable 45rem article column;
- the existing homepage design and asset isolation.

The existing uncommitted work in `docs/src/components/editor.tsx` is out of
scope and must not be overwritten.

## Current Problems

The final rule in `docs/src/tailwind.css` sets the top margin between almost
all adjacent Markdown blocks to zero. This removes Starlight's vertical rhythm
and makes paragraphs, headings, lists, and editors look like one continuous
block.

Other systemic problems are:

- frontmatter descriptions are not displayed in the article header;
- heading hierarchy is visually weak;
- Monaco editors and static code blocks look unrelated and lack a clear
  surface boundary;
- sidebar, table of contents, and pagination do not match the v3 homepage;
- mobile code scrolling has no visible affordance;
- the API Reference is almost 11,000px tall and difficult to scan;
- Testing presents five large examples without a consistent summary of each
  test boundary.

## Visual System

Internal pages will use the homepage's cool navy, violet, and teal direction
without copying its hero treatment.

Shared tokens will define:

- page, raised-surface, border, text, muted-text, primary, and secondary
  colors for both themes;
- consistent medium and large radii;
- subtle hairline borders and low-contrast shadows;
- visible keyboard focus rings;
- article typography and spacing.

The article column remains 45rem wide. Body copy uses approximately
`1rem / 1.75`; the lead uses approximately `1.1rem / 1.7`. H1 scales from
about 2.6rem to 3.25rem, and H2 from about 1.65rem to 2rem. Major sections
receive enough top spacing to be visually distinct without turning every
section into a card.

The homepage remains isolated through its hero template and `.not-content`
root. Documentation styles target ordinary Starlight page and Markdown
containers, not the homepage workbench.

## Article Header

Override Starlight's `PageTitle` component on non-hero pages.

The header contains:

1. a small section label derived from the route:
   `GUIDE`, `CORE CONCEPT`, `ADVANCED`, or `REFERENCE`;
2. the existing H1 with the unchanged `#_top` target;
3. the existing frontmatter `description` as a readable lead.

No MDX file needs to duplicate this header. Hero pages continue using the
existing Starlight hero path, so the homepage is unchanged.

## Markdown and Navigation

Restore the normal block rhythm first, then apply a focused shared layer for:

- headings and heading anchor states;
- paragraphs, lists, blockquotes, and horizontal rules;
- inline code, fenced code, tables, and native details;
- sidebar groups and active items;
- desktop and mobile table of contents;
- previous/next pagination cards.

Links keep an underline or another non-color cue. Active and focus states meet
WCAG contrast requirements. Sidebar and table-of-contents behavior remains
Starlight-native.

## Code and Editors

Do not modify the current `Editor` implementation as part of this redesign.
Style its existing Astro island and Monaco surface from the shared CSS layer.

Interactive editors and fenced code blocks share:

- the same raised background, border, and radius;
- deliberate vertical separation from surrounding prose;
- consistent typography and focus treatment;
- a visible horizontal-scroll affordance on narrow screens;
- no document-level horizontal overflow.

Monaco remains editable and continues to provide TypeScript diagnostics and
hover information. The server-rendered `<pre>` fallback remains readable when
JavaScript or Monaco fails to load. No new client-side JavaScript is added.

## API Reference

Keep `/reference/api/` as one route and preserve every existing symbol anchor.

Add a quick-reference index near the top and organize symbols into three
scan-friendly groups:

- Common API
- Factory configuration
- Advanced types

Existing symbol headings remain the anchor owners. The large internal
declarations for `makeModule` and `TModule` will be placed inside native
`<details>` sections titled `Full declaration`. Short public signatures,
descriptions, parameters, examples, and every declaration remain present in
the document.

This pass does not split the API into new routes.

## Testing Guide

Before each large test example, add a compact semantic summary with:

- Boundary
- Kept real
- Replaced
- What the assertions prove

Implement each summary as a semantic `<dl class="example-contract">` styled by
the shared CSS layer. These summaries reorganize information already explained
by the guide. They do not replace examples or introduce new testing claims.
Any existing example correctness fixes remain separate from this visual
redesign.

## Responsive Behavior

At mobile widths:

- article gutters are 16px;
- interactive controls remain at least 44px;
- article text and headings do not require zooming;
- code and editors scroll internally with a visible cue;
- sidebar and TOC retain Starlight's accessible disclosure behavior;
- the document itself never overflows horizontally.

The desktop layout keeps the left navigation, 45rem article column, and right
TOC. Intermediate widths must not create clipped editors or overlapping
navigation.

## Implementation Boundaries

Expected implementation files:

- `docs/src/tailwind.css`
- a new Starlight `PageTitle` override component
- `docs/astro.config.mjs`
- `docs/src/content/docs/reference/api.mdx`
- `docs/src/content/docs/guides/testing.mdx`

Other MDX pages should benefit from the shared system without broad
page-by-page rewrites. The Testing summaries use semantic MDX/HTML rather than
adding a client component.

Do not:

- redesign the homepage again;
- replace Starlight navigation behavior;
- add a client-side design system runtime;
- remove or shorten technical content;
- change library APIs;
- overwrite unrelated work in `editor.tsx`.

## Verification

Verification must include:

- `docs:check` and a production docs build;
- desktop dark/light screenshots for Introduction, Module, Testing, and API;
- mobile screenshots at 390px and an overflow check at 320px;
- unchanged public routes and symbol anchors;
- working sidebar, TOC, pagination, and keyboard focus;
- Monaco initialization, TypeScript diagnostics, and hover behavior;
- readable no-JavaScript editor fallbacks;
- no homepage visual or asset-loading regression;
- accessibility and maintainability review before the final commit.

## Success Criteria

The redesign is successful when documentation pages visibly belong to the v3
site, headings and examples can be scanned without visual crowding, the API
Reference has a clear map, mobile code is discoverably scrollable, and no
content, route, anchor, editor capability, or homepage behavior is lost.
