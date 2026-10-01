import type { Monaco } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';

type SourceFile = { name: string; uri: string; code: string };

const libraryRoot = 'file:///node_modules/@favy/di/src/';

function diagnosticMessage(
  message: string | languages.typescript.DiagnosticMessageChain | undefined
): string {
  if (!message) return 'TypeScript error';
  if (typeof message === 'string') return message;
  return [
    message.messageText,
    ...(message.next ?? []).map(diagnosticMessage),
  ].join('\n');
}

export async function compileExample(
  monaco: Monaco,
  models: ReadonlyMap<string, editor.ITextModel>,
  entry: string,
  signal: AbortSignal
): Promise<{ modules: Record<string, string>; entry: string }> {
  signal.throwIfAborted();
  // Snapshot every tab before starting asynchronous work. Later edits belong
  // to the next run, including edits in tabs that have never been opened.
  const files: SourceFile[] = [...models].map(([name, model]) => ({
    name,
    uri: model.uri.toString(),
    code: model.getValue(),
  }));
  const main = files.find((file) => file.name === entry);
  if (!main) throw new Error(`Entry file "${entry}" was not found.`);

  const defaults = monaco.languages.typescript.typescriptDefaults;
  const extraLibs = { ...defaults.getExtraLibs() };
  for (const file of files) {
    extraLibs[file.uri] = { content: file.code, version: 1 };
  }
  const compiler =
    monaco.editor.createWebWorker<languages.typescript.TypeScriptWorker>({
      moduleId: 'vs/language/typescript/tsWorker',
      label: 'typescript',
      createData: {
        compilerOptions: {
          ...defaults.getCompilerOptions(),
          module: monaco.languages.typescript.ModuleKind.CommonJS,
          // Match the editor's resolution of the virtual @favy/di declaration.
          moduleResolution:
            monaco.languages.typescript.ModuleResolutionKind.Classic,
          noEmit: false,
          sourceMap: false,
        },
        extraLibs,
      },
    });

  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  let timeout: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Compilation timed out. Try running again.')),
      20_000
    );
  });

  try {
    return await Promise.race([
      (async () => {
        const worker = await compiler.getProxy();
        const ignored = new Set(
          defaults.getDiagnosticsOptions().diagnosticCodesToIgnore
        );
        const errors: string[] = [];
        for (const file of files) {
          signal.throwIfAborted();
          const diagnostics = [
            ...(await worker.getSyntacticDiagnostics(file.uri)),
            ...(await worker.getSemanticDiagnostics(file.uri)),
          ];
          for (const diagnostic of diagnostics) {
            if (diagnostic.category !== 1 || ignored.has(diagnostic.code))
              continue;
            const prefix = file.code
              .slice(0, diagnostic.start ?? 0)
              .split('\n');
            errors.push(
              `${file.name}:${prefix.length}:${prefix.at(-1)!.length + 1} — TS${
                diagnostic.code
              }: ${diagnosticMessage(diagnostic.messageText)}`
            );
          }
        }
        if (errors.length) throw new Error(errors.slice(0, 10).join('\n'));

        const modules: Record<string, string> = {};
        const paths = [
          ...Object.keys(extraLibs).filter(
            (path) => path.startsWith(libraryRoot) && !path.endsWith('.d.ts')
          ),
          ...files.map((file) => file.uri),
        ];
        for (const path of paths) {
          signal.throwIfAborted();
          const result = await worker.getEmitOutput(path);
          const output = result.outputFiles.find((file) =>
            file.name.endsWith('.js')
          );
          if (result.emitSkipped || !output)
            throw new Error(`Could not compile ${path.split('/').at(-1)}.`);
          modules[path] = output.text;
        }
        return { modules, entry: main.uri };
      })(),
      aborted,
      timedOut,
    ]);
  } finally {
    clearTimeout(timeout!);
    signal.removeEventListener('abort', onAbort);
    compiler.dispose();
  }
}
