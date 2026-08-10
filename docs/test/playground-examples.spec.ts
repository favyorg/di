import path from 'node:path';
import ts from 'typescript';
import { playgroundExamples } from '../src/components/playground/playground-examples';

const workspace = path.resolve(__dirname, '../..');

const diagnosticsFor = (
  id: string,
  source: string
): readonly ts.Diagnostic[] => {
  const filename = path.join(
    workspace,
    'docs',
    'test',
    '__virtual__',
    `${id}.ts`
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: workspace,
    paths: { '@favy/di': ['di/src/index.ts'] },
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists;
  const originalReadFile = host.readFile;
  const originalGetSourceFile = host.getSourceFile;
  host.fileExists = (file) => file === filename || originalFileExists(file);
  host.readFile = (file) =>
    file === filename ? source : originalReadFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
    file === filename
      ? ts.createSourceFile(file, source, languageVersion, true)
      : originalGetSourceFile(file, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([filename], options, host);
  return ts.getPreEmitDiagnostics(program);
};

it('ships six standalone strict TypeScript examples', () => {
  expect(playgroundExamples.map(({ id }) => id)).toEqual([
    'basic',
    'composition',
    'replace',
    'partial',
    'lazy-cache',
    'hkt',
  ]);
  for (const example of playgroundExamples) {
    const diagnostics = diagnosticsFor(example.id, example.source);
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      )
    ).toEqual([]);
    expect(example.source).toContain('console.log');
  }
});
