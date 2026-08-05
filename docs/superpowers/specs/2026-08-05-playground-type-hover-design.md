# Shared TypeScript Editor and Playground Hover Design

**Date:** 2026-08-05

## Goal

Show real TypeScript quick-info on hover in both ordinary documentation examples
and the interactive playground, including inferred HKT types from `@favy/di`,
without changing the warmed Sandpack execution runtime.

## Confirmed causes

The two surfaces currently fail for different reasons:

- Ordinary examples mount Monaco, but `editor.tsx` loads the TypeScript worker
  contribution without registering the TypeScript language. Monaco silently
  creates `plaintext` models, so no tokens, diagnostics, or hover provider are
  available.
- The playground mounts `SandpackCodeEditor`. Its CodeMirror configuration
  provides TypeScript syntax parsing only; it has no TypeScript language
  service or hover extension. Sandpack's Nodebox dependencies and declaration
  files are private to the execution iframe and are not an editor type model.

## Architecture

Create one shared controlled Monaco/TypeScript editor layer and use it on both
surfaces. Sandpack remains the playground's package installer, Vite server, and
execution runtime; it no longer owns the visible editor.

The shared loader initializes exactly once per page:

1. Import Monaco's editor API.
2. Import both
   `vs/basic-languages/typescript/typescript.contribution` and
   `vs/language/typescript/monaco.contribution`.
3. Install the editor and TypeScript workers.
4. Configure strict TypeScript compiler options.
5. Add the local `@favy/di` source declarations once, using the existing raw
   source files and ambient module declaration.

Both documentation examples and the playground consume this loader instead of
maintaining separate Monaco setup.

## Shared editor interface

The shared component supports two modes through one small interface:

```ts
type TypeScriptEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  height: number | string;
  modelPath: string;
  readOnly?: boolean;
  fallback: ReactNode;
  onMount?: (editor: MonacoEditor) => void;
};
```

- Ordinary examples pass no outward `onChange`; they keep their current local
  editability, but edits remain private to that editor model.
- The playground passes its live code and writes Monaco changes into
  Sandpack's active `/index.ts` file with `updateCode(value, false)`.
- Each instance uses a stable, unique `file:///.../*.ts` model path so multiple
  examples cannot overwrite one another.
- The component follows the document's `data-theme`, disconnects its observer
  on unmount, and disposes editor-specific resources.

## Playground integration

The playground preserves the existing behavior:

- Monaco changes update the draft, dependency debounce, example dirty state,
  Reset button, and Run snapshot exactly as CodeMirror changes do now.
- Example switching and Reset update the controlled Monaco value without
  triggering a false user-edit event.
- Focus, cursor, and selection are captured and restored through Monaco's
  editor API.
- The current highlighted Sandpack editor markup remains the loading/SSR
  fallback until Monaco is ready, so first-paint syntax highlighting does not
  regress.
- Monaco language tooling loads in parallel with the background Nodebox
  warmup. It does not block the runtime's Ready state or add work to a warm Run.

The runtime provider, dependency-keyed outer iframe, `fs/change` handshake,
and execution protocol remain unchanged by this feature.

## Type sources

`@favy/di` declarations are always local and immediately available after the
TypeScript worker starts. This guarantees hover for every bundled example,
including the HKT example, without a registry or CDN request.

For additional valid npm imports typed by the user, initialize
`monaco-editor-auto-typings/custom-editor` only in the playground:

- reuse the current validated dependency versions;
- pin `@favy/di` to the local declarations rather than downloading it;
- resolve other packages from the library's default declaration CDN;
- cache downloaded declarations in local storage;
- debounce acquisition by one second, matching dependency detection;
- cancel/dispose the loader with the editor and ignore stale results after an
  example or dependency revision changes.

Typing acquisition failure is non-fatal: editing and Run continue, while the
editor keeps the declarations already loaded.

## Loading and performance

Monaco and the TypeScript worker are already dependencies of the docs and are
code-split. The playground starts their dynamic imports immediately, in
parallel with Sandpack warmup, while rendering the existing fallback.

This intentionally trades a larger background language-tooling download for a
single proven editor implementation. It avoids shipping a second custom
CodeMirror language-service bridge and keeps the 30–93 ms warmed execution path
independent from editor initialization.

## Accessibility and failure behavior

- The editor keeps an explicit TypeScript label and multiline textbox
  semantics supplied by Monaco.
- Hover content must also be reachable through Monaco's keyboard-accessible
  quick-info command.
- If Monaco fails to initialize, the existing highlighted fallback remains
  visible and the runtime does not crash.
- The loading transition must not steal focus from another control.

## Verification

Automated tests must prove:

- TypeScript is registered before a model is created; a model requested as
  TypeScript is not `plaintext`.
- Local `@favy/di` declarations are installed once.
- Ordinary examples still render their SSR fallback and then hydrate Monaco.
- Playground edits, Reset, example switching, focus, selection, dependency
  debounce, and Run snapshots work through the controlled adapter.
- A browser hover over `Module` and an inferred HKT value produces a visible
  `.monaco-hover` containing non-empty TypeScript quick-info.
- A fresh browser session performs no Monaco or TypeScript download during a
  warm Run measurement after editor readiness.
- Existing runtime persistence, zero-registry-after-ready, syntax-first-paint,
  accessibility, and production-build checks remain green.

## Out of scope

- Replacing Sandpack's execution runtime.
- Building a new CodeMirror TypeScript language server.
- Adding completions, refactors, or diagnostics beyond Monaco's existing
  TypeScript capabilities.
- Changing the public library API or HKT implementation.
