# README and llms.txt v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align both public README copies and `llms.txt` with the current compact v3 API and documentation.

**Architecture:** `README.md` is the human onboarding source and is copied byte-for-byte to `di/README.md` for npm. `docs/public/llms.txt` is a separate, spec-compatible routing index that links to authoritative documentation instead of duplicating it.

**Tech Stack:** Markdown, TypeScript examples, Astro/Starlight, Nx

## Global Constraints

- Keep `README.md` and `di/README.md` byte-for-byte identical.
- Do not change the library API, documentation pages, or editor implementation.
- Use deterministic, complete TypeScript examples.
- Use canonical `https://di.favy.dev/` links.
- Keep advanced HKT declarations and runtime edge cases in focused documentation.

---

### Task 1: Rewrite the synchronized README

**Files:**
- Modify: `README.md`
- Modify: `di/README.md`

**Interfaces:**
- Consumes: current v3 `Module`, `Live`, `.provide()`, and lifecycle behavior
- Produces: one identical human-facing README for GitHub and npm

- [ ] **Step 1: Verify the current README lacks the approved v3 onboarding**

Run:

```bash
rg -n 'Dependency graphs, just typed functions|type ClockLive|Default lifecycle' README.md
```

Expected: no matches and exit code 1.

- [ ] **Step 2: Replace the README content**

Write these sections in order:

1. `# @favy/di`, existing badges, and the line “Dependency graphs, just typed functions.”
2. A concise v3 description and feature list.
3. Installation with the TypeScript 5+ requirement.
4. `Clock` → `type ClockLive = Live<typeof Clock>` → `Greeting` quick start.
5. Three mental-model bullets for `Module`, `Live<T>`, and the composition root.
6. A boundary-replacement call using a fixed `{ now: () => ... }` value.
7. A deterministic `Add`/`AddTen` `.provide()` example.
8. A two-row lifecycle table for `lazy: true` and `cache: 'run'`.
9. Focused links for introduction, testing, caching, lazy initialization, partial application, input/output transforms, and API reference.
10. Contribution and license sections.

- [ ] **Step 3: Mirror the canonical README into the npm package**

Apply the same content patch to `di/README.md`; do not change wording or
formatting between the two files.

- [ ] **Step 4: Verify synchronization and required concepts**

Run:

```bash
cmp README.md di/README.md
rg -n 'type ClockLive|\\.provide\\(|lazy: true|cache.*run|guides/testing|transform-input|transform-output' README.md
```

Expected: `cmp` exits 0 and every required concept has a match.

- [ ] **Step 5: Commit the README update**

```bash
git add README.md di/README.md
git commit -m "docs: refresh v3 README"
```

### Task 2: Convert llms.txt into a routing index

**Files:**
- Modify: `docs/public/llms.txt`

**Interfaces:**
- Consumes: canonical public documentation routes
- Produces: a compact llms.txt document whose H2 sections contain described Markdown links

- [ ] **Step 1: Verify the current file is not a pure Markdown-link index**

Run:

```bash
node -e "const s=require('fs').readFileSync('docs/public/llms.txt','utf8'); if (/^- \\[[^\\]]+\\]\\(https:\\/\\/[^)]+\\): .+/m.test(s)) process.exit(1)"
```

Expected: exit code 0 because the current file uses bare URLs and embedded prose/code.

- [ ] **Step 2: Rewrite llms.txt**

Keep only:

1. `# @favy/di`.
2. A blockquote identifying v3, TypeScript 5+, typed named functions, and the absence of decorators/container configuration.
3. A short note that standard `Module` is lazy and run-cached, `Live<T>` carries transitive requirements, and the API reference is authoritative.
4. `## Core documentation` links to Introduction, Module, API Reference, Partial Application, Caching, and Lazy Initialization.
5. `## Guides` links to Testing and Best Practices.
6. `## Optional` links to Transform Input, Transform Output, and the source repository.

Every list item must use:

```md
- [Title](https://canonical-url/): Concise description.
```

- [ ] **Step 3: Validate structure and links**

Run:

```bash
node -e "const s=require('fs').readFileSync('docs/public/llms.txt','utf8'); const sections=s.split(/^## /m).slice(1); if (!/^# @favy\\/di\\n\\n> .*v3/m.test(s) || sections.some(x => x.split('\\n').slice(1).filter(Boolean).some(line => !/^- \\[[^\\]]+\\]\\(https:\\/\\/[^)]+\\): .+/.test(line)))) process.exit(1)"
```

Expected: exit code 0.

- [ ] **Step 4: Run project verification**

Run:

```bash
cmp README.md di/README.md
npx nx run docs:check --skip-nx-cache
npx nx run docs:build --skip-nx-cache
DOCS_URL=http://127.0.0.1:4321 node docs/scripts/docs-pages-smoke.mjs
```

Expected: README copies match, Astro check reports zero errors, the production build succeeds, and the smoke suite passes against the running dev server.

- [ ] **Step 5: Commit the llms.txt update**

```bash
git add docs/public/llms.txt
git commit -m "docs: make llms index v3-ready"
```
