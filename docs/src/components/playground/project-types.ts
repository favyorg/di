export type PlaygroundProject = Readonly<{
  id: string;
  title: string;
  description: string;
  exercise: string;
  concept: string;
  section:
    | 'Fundamentals'
    | 'Generators'
    | 'Lifecycle'
    | 'Applications'
    | 'Extensions';
  expectedOutput: string;
  docs: string;
  note?: string;
  comparison?: readonly { id: string; label: string }[];
  preview?: 'browser';
  entry: string;
  activeFile: string;
  files: Readonly<Record<string, string>>;
}>;

export const lessonSource = (code: string) =>
  code.replace(/(?:\.\.\/)+di\/src/g, '@favy/di');
