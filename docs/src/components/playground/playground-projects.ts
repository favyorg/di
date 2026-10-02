import firstGreeting from '../../examples/projects/first-module/greeting.ts?raw';
import firstApp from '../../examples/projects/first-module/app.ts?raw';
import dependencyMessages from '../../examples/projects/dependencies/messages.ts?raw';
import dependencyGreeting from '../../examples/projects/dependencies/greeting.ts?raw';
import dependencyApp from '../../examples/projects/dependencies/app.ts?raw';
import generatorMessages from '../../examples/projects/generators/messages.ts?raw';
import generatorGreeting from '../../examples/projects/generators/greeting.ts?raw';
import generatorApp from '../../examples/projects/generators/app.ts?raw';

export type PlaygroundProject = Readonly<{
  id: string;
  title: string;
  description: string;
  exercise: string;
  concept: string;
  entry: string;
  activeFile: string;
  files: Readonly<Record<string, string>>;
}>;

const source = (code: string) =>
  code.replace(/(?:\.\.\/)+di\/src/g, '@favy/di');

export const playgroundProjects: readonly PlaygroundProject[] = [
  {
    id: 'first-module',
    title: 'Create a module',
    description:
      'Module defines a service. Calling Greeting() creates its value; Say is an ordinary method on that value.',
    exercise: 'In app.ts, change Alex to your name and press Run.',
    concept: 'Module',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: { '/greeting.ts': source(firstGreeting), '/app.ts': firstApp },
  },
  {
    id: 'dependencies',
    title: 'Add a dependency',
    description:
      'Move the greeting word into Messages. typeof Messages.Live describes the dependency; app.ts supplies its implementation.',
    exercise:
      "In app.ts, replace { Messages } with { Messages: { hello: 'Hi' } }. Run again: Greeting stays unchanged.",
    concept: 'Typed dependencies',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: {
      '/greeting.ts': source(dependencyGreeting),
      '/messages.ts': source(dependencyMessages),
      '/app.ts': dependencyApp,
    },
  },
  {
    id: 'generators',
    title: 'Use a generator',
    description:
      'Keep the same greeting. Tag declares the Messages contract; yield* requests it and infers the dependency type automatically.',
    exercise:
      'Compare greeting.ts with step 2. Then change hello in DefaultMessages and run: the value is supplied through the tag.',
    concept: 'Tag + GenModule',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: {
      '/greeting.ts': source(generatorGreeting),
      '/messages.ts': source(generatorMessages),
      '/app.ts': generatorApp,
    },
  },
];

export const projectById: Readonly<Record<string, PlaygroundProject>> =
  Object.fromEntries(
    playgroundProjects.map((project) => [project.id, project])
  );
