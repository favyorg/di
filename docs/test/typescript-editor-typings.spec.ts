import type { Monaco } from '@monaco-editor/react';
import type { SourceCache, SourceResolver } from 'monaco-editor-auto-typings';
import { createAutoTypingsGeneration } from '../src/components/typescript-editor-typings';

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}>;

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const response = (text: string | Promise<string>, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn(() => Promise.resolve(text)),
  } as unknown as Response);

const emptySourceCache = (): SourceCache => ({
  getFile: jest.fn(async () => undefined),
  storeFile: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
});

type MockTextModel = Readonly<{
  dispose: jest.Mock<void, []>;
  getValue(): string;
}>;

const createMonacoHarness = () => {
  const models = new Map<unknown, MockTextModel>();
  const createModel = jest.fn(
    (content: string, _language: string, uri: unknown): MockTextModel => {
      const model: MockTextModel = {
        dispose: jest.fn(() => {
          models.delete(uri);
        }),
        getValue: () => content,
      };
      models.set(uri, model);
      return model;
    }
  );
  const getModel = jest.fn((uri: unknown) => models.get(uri) ?? null);
  const monaco = {
    editor: {
      createModel,
      getModel,
    },
  } as unknown as Monaco;

  return { createModel, getModel, models, monaco };
};

type ResolverCase = Readonly<{
  label: string;
  resolve(sourceResolver: SourceResolver): Promise<string | undefined>;
  url: string;
}>;

const resolverCases: readonly ResolverCase[] = [
  {
    label: 'package JSON',
    resolve: (sourceResolver) =>
      sourceResolver.resolvePackageJson('pkg', '1', 'feature'),
    url: 'https://cdn.jsdelivr.net/npm/pkg@1/feature/package.json',
  },
  {
    label: 'source file',
    resolve: (sourceResolver) =>
      sourceResolver.resolveSourceFile('pkg', '1', 'index.d.ts'),
    url: 'https://cdn.jsdelivr.net/npm/pkg@1/index.d.ts',
  },
];

describe.each(resolverCases)(
  '$label resolver generation guards',
  (resolverCase) => {
    it('aborts before the fetch response and returns no stale content', async () => {
      const pendingFetch = deferred<Response>();
      const fetchSource = jest.fn(
        (_input: RequestInfo | URL, _init?: RequestInit) => pendingFetch.promise
      ) as unknown as typeof globalThis.fetch;
      const { monaco } = createMonacoHarness();
      const generation = createAutoTypingsGeneration({
        monaco,
        sourceCache: emptySourceCache(),
        fetchSource,
      });

      const pending = resolverCase.resolve(generation.sourceResolver);
      const [, request] = (fetchSource as jest.Mock).mock.calls[0] as [
        string,
        RequestInit
      ];
      const fetchedResponse = response('export type Old = true');
      generation.invalidate();

      expect(request.signal?.aborted).toBe(true);
      pendingFetch.resolve(fetchedResponse);
      await expect(pending).resolves.toBeUndefined();
      expect(fetchedResponse.text).not.toHaveBeenCalled();
      expect(fetchSource).toHaveBeenCalledWith(
        resolverCase.url,
        expect.objectContaining({ method: 'GET', signal: request.signal })
      );
    });

    it('returns no stale content when invalidated while reading response text', async () => {
      const pendingText = deferred<string>();
      const fetchedResponse = response(pendingText.promise);
      const fetchSource = jest.fn(
        async () => fetchedResponse
      ) as unknown as typeof globalThis.fetch;
      const { monaco } = createMonacoHarness();
      const generation = createAutoTypingsGeneration({
        monaco,
        sourceCache: emptySourceCache(),
        fetchSource,
      });

      const pending = resolverCase.resolve(generation.sourceResolver);
      await Promise.resolve();
      expect(fetchedResponse.text).toHaveBeenCalledTimes(1);

      generation.invalidate();
      pendingText.resolve('export type Old = true');

      await expect(pending).resolves.toBeUndefined();
    });
  }
);

it.each(resolverCases)(
  'does not start a $label request after invalidation',
  async (resolverCase) => {
    const fetchSource = jest.fn(async () =>
      response('export type Stale = true')
    ) as unknown as typeof globalThis.fetch;
    const { monaco } = createMonacoHarness();
    const generation = createAutoTypingsGeneration({
      monaco,
      sourceCache: emptySourceCache(),
      fetchSource,
    });

    generation.invalidate();

    await expect(
      resolverCase.resolve(generation.sourceResolver)
    ).resolves.toBeUndefined();
    expect(fetchSource).not.toHaveBeenCalled();
  }
);

it('propagates resolver failures only while the generation is active', async () => {
  const activeError = new Error('network unavailable');
  const activeFetch = jest.fn(async () => {
    throw activeError;
  }) as unknown as typeof globalThis.fetch;
  const { monaco } = createMonacoHarness();
  const activeGeneration = createAutoTypingsGeneration({
    monaco,
    sourceCache: emptySourceCache(),
    fetchSource: activeFetch,
  });

  await expect(
    activeGeneration.sourceResolver.resolveSourceFile('pkg', '1', 'index.d.ts')
  ).rejects.toBe(activeError);

  const pendingFetch = deferred<Response>();
  const staleFetch = jest.fn(
    () => pendingFetch.promise
  ) as unknown as typeof globalThis.fetch;
  const staleGeneration = createAutoTypingsGeneration({
    monaco,
    sourceCache: emptySourceCache(),
    fetchSource: staleFetch,
  });
  const pending = staleGeneration.sourceResolver.resolvePackageJson('pkg');
  staleGeneration.invalidate();
  pendingFetch.reject(new DOMException('Aborted', 'AbortError'));

  await expect(pending).resolves.toBeUndefined();
});

it('preserves active resolver response semantics', async () => {
  const fetchSource = jest
    .fn()
    .mockResolvedValueOnce(response('', 404))
    .mockResolvedValueOnce(
      response('', 503)
    ) as unknown as typeof globalThis.fetch;
  const { monaco } = createMonacoHarness();
  const generation = createAutoTypingsGeneration({
    monaco,
    sourceCache: emptySourceCache(),
    fetchSource,
  });

  await expect(
    generation.sourceResolver.resolvePackageJson('missing')
  ).resolves.toBe('');
  await expect(
    generation.sourceResolver.resolveSourceFile('broken', '1', 'index.d.ts')
  ).rejects.toThrow();
});

it('returns no content from a cache read completed after invalidation', async () => {
  const pendingFile = deferred<string | undefined>();
  const getFile = jest.fn(() => pendingFile.promise);
  const sourceCache: SourceCache = {
    getFile,
    storeFile: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
  const { monaco } = createMonacoHarness();
  const generation = createAutoTypingsGeneration({ monaco, sourceCache });

  const pending = generation.sourceCache.getFile('pkg@1/index.d.ts');
  generation.invalidate();
  pendingFile.resolve('export type Old = true');

  await expect(pending).resolves.toBeUndefined();
  expect(getFile).toHaveBeenCalledTimes(1);
});

it('returns unavailable from an availability read completed after invalidation', async () => {
  const pendingAvailability = deferred<boolean>();
  const isFileAvailable = jest.fn(() => pendingAvailability.promise);
  const sourceCache: SourceCache = {
    isFileAvailable,
    getFile: jest.fn(async () => undefined),
    storeFile: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
  const { monaco } = createMonacoHarness();
  const generation = createAutoTypingsGeneration({ monaco, sourceCache });

  const pending = generation.sourceCache.isFileAvailable?.('pkg@1/index.d.ts');
  generation.invalidate();
  pendingAvailability.resolve(true);

  await expect(pending).resolves.toBe(false);
  expect(isFileAvailable).toHaveBeenCalledTimes(1);
});

it('does not start cache reads after invalidation', async () => {
  const isFileAvailable = jest.fn(async () => true);
  const getFile = jest.fn(async () => 'export type Stale = true');
  const sourceCache: SourceCache = {
    isFileAvailable,
    getFile,
    storeFile: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
  const { monaco } = createMonacoHarness();
  const generation = createAutoTypingsGeneration({ monaco, sourceCache });

  generation.invalidate();

  await expect(
    generation.sourceCache.getFile('stale')
  ).resolves.toBeUndefined();
  await expect(generation.sourceCache.isFileAvailable?.('stale')).resolves.toBe(
    false
  );
  expect(getFile).not.toHaveBeenCalled();
  expect(isFileAvailable).not.toHaveBeenCalled();
});

it('suppresses invalidated cache failures and propagates active failures', async () => {
  const activeError = new Error('storage unavailable');
  const pendingFile = deferred<string | undefined>();
  const sourceCache: SourceCache = {
    getFile: jest
      .fn()
      .mockRejectedValueOnce(activeError)
      .mockImplementationOnce(() => pendingFile.promise),
    storeFile: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
  const { monaco } = createMonacoHarness();
  const generation = createAutoTypingsGeneration({ monaco, sourceCache });

  await expect(generation.sourceCache.getFile('active')).rejects.toBe(
    activeError
  );
  const staleRead = generation.sourceCache.getFile('stale');
  generation.invalidate();
  pendingFile.reject(new Error('late storage failure'));

  await expect(staleRead).resolves.toBeUndefined();
});

it('does not store or clear shared cache state after invalidation', async () => {
  const storeFile = jest.fn(async () => undefined);
  const clear = jest.fn(async () => undefined);
  const sourceCache: SourceCache = {
    getFile: jest.fn(async () => undefined),
    storeFile,
    clear,
  };
  const { monaco } = createMonacoHarness();
  const generation = createAutoTypingsGeneration({ monaco, sourceCache });

  generation.invalidate();
  await generation.sourceCache.storeFile(
    'pkg@1/index.d.ts',
    'export type Old = true'
  );
  await generation.sourceCache.clear();

  expect(storeFile).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});

it('disposes only facade-created models and refuses stale model writes', () => {
  const { createModel, monaco } = createMonacoHarness();
  const existingUri = { path: '/existing.d.ts' } as never;
  const ownedUri = { path: '/owned.d.ts' } as never;
  const staleUri = { path: '/stale.d.ts' } as never;
  const existingModel = monaco.editor.createModel(
    'export type Existing = true',
    'typescript',
    existingUri
  ) as unknown as MockTextModel;
  const generation = createAutoTypingsGeneration({
    monaco,
    sourceCache: emptySourceCache(),
  });

  expect(generation.monaco.editor.getModel(existingUri)).toBe(existingModel);
  const ownedModel = generation.monaco.editor.createModel(
    'export type Owned = true',
    'typescript',
    ownedUri
  ) as unknown as MockTextModel;

  generation.invalidate();
  generation.invalidate();
  const staleModel = generation.monaco.editor.createModel(
    'export type Stale = true',
    'typescript',
    staleUri
  );

  expect(existingModel.dispose).not.toHaveBeenCalled();
  expect(ownedModel.dispose).toHaveBeenCalledTimes(1);
  expect(staleModel).toBeUndefined();
  expect(createModel).toHaveBeenCalledTimes(2);
});

it('allows the next generation to recreate a disposed versionless URI', () => {
  const { createModel, monaco } = createMonacoHarness();
  const uri = { path: '/node_modules/pkg/index.d.ts' } as never;
  const firstGeneration = createAutoTypingsGeneration({
    monaco,
    sourceCache: emptySourceCache(),
  });
  const oldModel = firstGeneration.monaco.editor.createModel(
    'export type Version = "old"',
    'typescript',
    uri
  ) as unknown as MockTextModel;

  firstGeneration.invalidate();

  const nextGeneration = createAutoTypingsGeneration({
    monaco,
    sourceCache: emptySourceCache(),
  });
  expect(nextGeneration.monaco.editor.getModel(uri)).toBeNull();
  const newModel = nextGeneration.monaco.editor.createModel(
    'export type Version = "new"',
    'typescript',
    uri
  ) as unknown as MockTextModel;

  expect(oldModel.dispose).toHaveBeenCalledTimes(1);
  expect(newModel.getValue()).toBe('export type Version = "new"');
  expect(createModel).toHaveBeenCalledTimes(2);
});
