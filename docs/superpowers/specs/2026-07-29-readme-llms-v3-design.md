# README and llms.txt v3 refresh

## Goal

Make the repository README, npm package README, and `llms.txt` describe the
current v3 API consistently without duplicating the full documentation.

## Scope

- Keep `README.md` and `di/README.md` byte-for-byte identical.
- Rewrite `docs/public/llms.txt` as a compact routing index.
- Do not change the library API, documentation pages, or editor implementation.

## README design

The README is a practical onboarding document rather than an API reference:

1. Position v3 as typed dependency graphs built from ordinary functions.
2. Install the package and state the TypeScript 5+ requirement.
3. Introduce `Module`, `Live`, and the composition root with one
   `Clock`/`Greeting` example.
4. Demonstrate replacing a dependency value at the application boundary.
5. Demonstrate partial application with a short `.provide()` example.
6. Summarize the default lifecycle (`lazy: true`, `cache: 'run'`) and link to
   focused documentation for caching, lazy resolution, testing, transforms,
   HKT support, and the API reference.
7. Retain contribution and license information.

Examples must be deterministic, complete TypeScript snippets. Low-level
runtime edge cases and full HKT declarations stay in the focused docs.

## llms.txt design

Follow the llms.txt Markdown convention:

- one H1 project name;
- one blockquote identifying v3 and the TypeScript requirement;
- a short paragraph with the essential `Module` and `Live<T>` mental model;
- H2 sections containing Markdown link lists with concise descriptions;
- an `Optional` section for transforms, HKT material, and source code.

Use the current working HTML documentation URLs because Markdown mirrors are
not available. Do not duplicate code samples or exported declarations in this
index; the API reference remains authoritative.

## Consistency rules

- README examples and terminology must match the current v3 implementation and
  documentation.
- The two README copies must remain identical.
- `llms.txt` must link every core page and classify secondary material as
  optional.
- Links must use canonical `https://di.favy.dev/` URLs.

## Verification

1. Compare both README files byte-for-byte.
2. Type-check README TypeScript examples against the local package declarations.
3. Validate the `llms.txt` heading and Markdown-link structure.
4. Check all public HTTP links.
5. Run the documentation check and production build.
6. Run the existing documentation smoke suite when a dev server is available.
