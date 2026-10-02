import type { Monaco } from '@monaco-editor/react';
import reactTypes from '../../../node_modules/@types/react/index.d.ts?raw';
import reactGlobals from '../../../node_modules/@types/react/global.d.ts?raw';
import reactJsx from '../../../node_modules/@types/react/jsx-runtime.d.ts?raw';
import reactJsxDev from '../../../node_modules/@types/react/jsx-dev-runtime.d.ts?raw';
import reactDomTypes from '../../../node_modules/@types/react-dom/index.d.ts?raw';
import reactDomClient from '../../../node_modules/@types/react-dom/client.d.ts?raw';
import propTypes from '../../../node_modules/@types/prop-types/index.d.ts?raw';
import cssTypes from '../../../node_modules/csstype/index.d.ts?raw';

// Bundle the installed React 18 declarations so editing never needs a CDN.
const sources = [
  ['@types/react/index.d.ts', reactTypes],
  ['@types/react/global.d.ts', reactGlobals],
  ['@types/react/jsx-runtime.d.ts', reactJsx],
  ['@types/react/jsx-dev-runtime.d.ts', reactJsxDev],
  ['@types/react-dom/index.d.ts', reactDomTypes],
  ['@types/react-dom/client.d.ts', reactDomClient],
  ['@types/prop-types/index.d.ts', propTypes],
  ['csstype/index.d.ts', cssTypes],
] as const;

const configured = new WeakSet<Monaco>();

export const configureProjectLanguageService = (monaco: Monaco): void => {
  if (configured.has(monaco)) return;

  const typescript = monaco.languages.typescript;
  for (const defaults of [
    typescript.typescriptDefaults,
    typescript.javascriptDefaults,
  ]) {
    defaults.setCompilerOptions({
      ...defaults.getCompilerOptions(),
      // Node resolution needs an explicit entry for the virtual local package.
      baseUrl: 'file:///',
      paths: {
        ...defaults.getCompilerOptions().paths,
        '@favy/di': ['file:///node_modules/@favy/di/src/index.ts'],
      },
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.NodeJs,
      jsx: typescript.JsxEmit.ReactJSX,
      strict: true,
      strictFunctionTypes: true,
      allowJs: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
    });
    defaults.setEagerModelSync(true);
    for (const [path, source] of sources) {
      defaults.addExtraLib(source, `file:///node_modules/${path}`);
    }
  }

  // CodeEditor already installs the current local DI sources for TypeScript.
  // Share those same declarations with JavaScript projects as well.
  for (const [path, source] of Object.entries(
    typescript.typescriptDefaults.getExtraLibs()
  )) {
    if (path.startsWith('file:///node_modules/@favy/di/')) {
      typescript.javascriptDefaults.addExtraLib(source.content, path);
    }
  }
  configured.add(monaco);
};
