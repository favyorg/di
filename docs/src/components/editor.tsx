import { CodeEditor } from './code-editor';
import { EditorFiles, type ExampleFile } from './editor-files';

type EditorProps =
  | { code: string; files?: never; entry?: never }
  | {
      code?: never;
      files: readonly [ExampleFile, ...ExampleFile[]];
      entry?: string;
    };

export function Editor(props: EditorProps) {
  return props.files ? (
    <EditorFiles files={props.files} entry={props.entry} />
  ) : (
    <CodeEditor code={props.code} />
  );
}
