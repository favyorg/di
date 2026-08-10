import type { Monaco } from '@monaco-editor/react';
import type { SourceCache, SourceResolver } from 'monaco-editor-auto-typings';

export type AutoTypingsGeneration = Readonly<{
  monaco: Monaco;
  sourceCache: SourceCache;
  sourceResolver: SourceResolver;
  invalidate(): void;
}>;

export function createAutoTypingsGeneration(
  options: Readonly<{
    monaco: Monaco;
    sourceCache: SourceCache;
    fetchSource?: typeof globalThis.fetch;
  }>
): AutoTypingsGeneration {
  const abortController = new AbortController();
  const ownedModels = new Set<ReturnType<Monaco['editor']['createModel']>>();
  let active = true;

  const readWhileActive = async <T>(
    unavailable: T,
    read: () => Promise<T>
  ): Promise<T> => {
    if (!active) return unavailable;

    try {
      const value = await read();
      return active ? value : unavailable;
    } catch (error) {
      if (!active) return unavailable;
      throw error;
    }
  };

  const sourceCache: SourceCache = {
    ...(options.sourceCache.isFileAvailable
      ? {
          isFileAvailable: (uri: string) =>
            readWhileActive(false, () =>
              options.sourceCache.isFileAvailable!(uri)
            ),
        }
      : {}),
    getFile: (uri) =>
      readWhileActive(undefined, () => options.sourceCache.getFile(uri)),
    storeFile: async (uri, content) => {
      if (!active) return;
      await options.sourceCache.storeFile(uri, content);
    },
    clear: async () => {
      if (!active) return;
      await options.sourceCache.clear();
    },
  };

  const resolveFile = async (url: string): Promise<string | undefined> => {
    if (!active) return undefined;

    try {
      const fetchedResponse = await (options.fetchSource ?? globalThis.fetch)(
        url,
        {
          method: 'GET',
          signal: abortController.signal,
        }
      );
      if (!active) return undefined;

      if (!fetchedResponse.ok) {
        if (fetchedResponse.status === 404) return '';
        throw new Error(`Failed to fetch typings from ${url}`);
      }

      const source = await fetchedResponse.text();
      return active ? source : undefined;
    } catch (error) {
      if (!active) return undefined;
      throw error;
    }
  };

  const sourceResolver: SourceResolver = {
    resolvePackageJson: (packageName, version, subPath) =>
      resolveFile(
        `https://cdn.jsdelivr.net/npm/${packageName}${
          version ? `@${version}` : ''
        }${subPath ? `/${subPath}` : ''}/package.json`
      ),
    resolveSourceFile: (packageName, version, path) =>
      resolveFile(
        `https://cdn.jsdelivr.net/npm/${packageName}${
          version ? `@${version}` : ''
        }/${path}`
      ),
  };

  const originalCreateModel = options.monaco.editor.createModel;
  const createModel: Monaco['editor']['createModel'] = (...arguments_) => {
    if (!active) {
      return undefined as unknown as ReturnType<
        Monaco['editor']['createModel']
      >;
    }

    const model = originalCreateModel(...arguments_);
    if (!active) {
      model.dispose();
      return undefined as unknown as ReturnType<
        Monaco['editor']['createModel']
      >;
    }
    ownedModels.add(model);
    return model;
  };

  const editorFacade = Object.create(options.monaco.editor) as Monaco['editor'];
  Object.defineProperty(editorFacade, 'createModel', { value: createModel });
  const monacoFacade = Object.create(options.monaco) as Monaco;
  Object.defineProperty(monacoFacade, 'editor', { value: editorFacade });

  return {
    monaco: monacoFacade,
    sourceCache,
    sourceResolver,
    invalidate: () => {
      if (!active) return;
      active = false;
      abortController.abort();
      for (const model of ownedModels) model.dispose();
      ownedModels.clear();
    },
  };
}
