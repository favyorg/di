import firstGreeting from '../../examples/projects/first-module/greeting.ts?raw';
import firstApp from '../../examples/projects/first-module/app.ts?raw';
import inputGreeting from '../../examples/projects/inputs/greeting.ts?raw';
import inputApp from '../../examples/projects/inputs/app.ts?raw';
import dependencyMessages from '../../examples/projects/dependencies/messages.ts?raw';
import dependencyGreeting from '../../examples/projects/dependencies/greeting.ts?raw';
import dependencyApp from '../../examples/projects/dependencies/app.ts?raw';
import transitiveMessages from '../../examples/projects/transitive/messages.ts?raw';
import transitiveGreeting from '../../examples/projects/transitive/greeting.ts?raw';
import transitiveApp from '../../examples/projects/transitive/app.ts?raw';
import replacementMessages from '../../examples/projects/replacement/messages.ts?raw';
import replacementGreeting from '../../examples/projects/replacement/greeting.ts?raw';
import replacementApp from '../../examples/projects/replacement/app.ts?raw';
import providedMessages from '../../examples/projects/provide/messages.ts?raw';
import providedGreeting from '../../examples/projects/provide/greeting.ts?raw';
import providedApp from '../../examples/projects/provide/app.ts?raw';
import { lessonSource, type PlaygroundProject } from './project-types';

export const basicLessons: readonly PlaygroundProject[] = [
  {
    id: 'first-module',
    title: 'Create a module',
    description:
      'Module creates a named callable. Greeting() runs its callback and returns a value with an ordinary Say method.',
    exercise: 'In app.ts, change Alex to your name and press Run.',
    concept: 'Module',
    section: 'Fundamentals',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/module/',
    note: 'typeof Greeting.Live is a type query. Reading Greeting.Live as a runtime value throws.',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: {
      '/greeting.ts': lessonSource(firstGreeting),
      '/app.ts': firstApp,
    },
  },
  {
    id: 'inputs',
    title: 'Pass a plain input',
    description:
      'Declare prefix in the dependency type. The callback receives it, and the root call in app.ts must supply it.',
    exercise: 'Change prefix in app.ts from Hello to Welcome and run again.',
    concept: 'Explicit inputs',
    section: 'Fundamentals',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/module/',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: {
      '/greeting.ts': lessonSource(inputGreeting),
      '/app.ts': inputApp,
    },
  },
  {
    id: 'dependencies',
    title: 'Add a dependency',
    description:
      'Move the greeting word into Messages. MessagesLive describes its named result; app.ts supplies the Messages provider.',
    exercise: 'Change hello in messages.ts to Welcome, then run app.ts again.',
    concept: 'typeof Messages.Live',
    section: 'Fundamentals',
    expectedOutput: 'Hello, Alex!',
    docs: '/module/module/#describe-a-graph-with-live',
    entry: '/app.ts',
    activeFile: '/greeting.ts',
    files: {
      '/greeting.ts': lessonSource(dependencyGreeting),
      '/messages.ts': lessonSource(dependencyMessages),
      '/app.ts': dependencyApp,
    },
  },
  {
    id: 'transitive',
    title: 'Carry requirements through a graph',
    description:
      'Messages now needs prefix and locale. MessagesLive carries both inputs into Greeting, so app.ts supplies every requirement in one flat object.',
    exercise:
      'Change prefix to Hola and locale to es in app.ts, then run again.',
    concept: 'Transitive Live requirements',
    section: 'Fundamentals',
    expectedOutput: 'Hello, Alex! (en)',
    docs: '/module/module/#describe-a-graph-with-live',
    note: 'MessagesLive contains prefix, locale, and the named Messages result. Greeting inherits all three fields.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: {
      '/app.ts': transitiveApp,
      '/greeting.ts': lessonSource(transitiveGreeting),
      '/messages.ts': lessonSource(transitiveMessages),
    },
  },
  {
    id: 'replacement',
    title: 'Replace a dependency at the root',
    description:
      'A dependency key accepts its produced value or a module that produces it. Supplying a different Messages value changes the greeting without editing Greeting.',
    exercise:
      "Replace Messages: { hello: 'Hi', locale: 'en' } in the second call with Messages, then run again. Both lines say Hello.",
    concept: 'Value or provider',
    section: 'Fundamentals',
    expectedOutput: 'Hello, Alex! (en)\nHi, Alex! (en)',
    docs: '/guides/introduction/#the-composition-root',
    note: 'Replacing Messages does not remove prefix or locale from the declared Live contract. Both remain required even when this replacement value does not use them.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: {
      '/app.ts': replacementApp,
      '/greeting.ts': lessonSource(replacementGreeting),
      '/messages.ts': lessonSource(replacementMessages),
    },
  },
  {
    id: 'provide',
    title: 'Bind inputs in stages',
    description:
      'Each provide call binds named dependency keys and returns another callable. Bind Messages and locale now; supply the remaining prefix when calling EnglishGreeting.',
    exercise:
      "Add .provide({ prefix: 'Welcome' }) to the chain, then call EnglishGreeting() with no arguments.",
    concept: 'Chained .provide()',
    section: 'Fundamentals',
    expectedOutput: 'Hello, Alex! (en)',
    docs: '/module/partial/#chain-provide',
    note: 'Binding Messages alone leaves its transitive prefix and locale inputs. Each disappears from the call signature only when it is explicitly bound.',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: {
      '/app.ts': providedApp,
      '/greeting.ts': lessonSource(providedGreeting),
      '/messages.ts': lessonSource(providedMessages),
    },
  },
];
