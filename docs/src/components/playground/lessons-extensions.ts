import inputFactory from '../../examples/projects/transform-input/factory.ts?raw';
import inputGreeting from '../../examples/projects/transform-input/greeting.ts?raw';
import inputApp from '../../examples/projects/transform-input/app.ts?raw';
import outputFactory from '../../examples/projects/transform-output/factory.ts?raw';
import outputGreeting from '../../examples/projects/transform-output/greeting.ts?raw';
import outputApp from '../../examples/projects/transform-output/app.ts?raw';
import outputHktFactory from '../../examples/projects/output-hkt/factory.ts?raw';
import outputHktScore from '../../examples/projects/output-hkt/score.ts?raw';
import outputHktApp from '../../examples/projects/output-hkt/app.ts?raw';
import inputHktFactory from '../../examples/projects/input-hkt/factory.ts?raw';
import inputHktSum from '../../examples/projects/input-hkt/sum.ts?raw';
import inputHktApp from '../../examples/projects/input-hkt/app.ts?raw';
import resultFactory from '../../examples/projects/async-result/factory.ts?raw';
import resultMain from '../../examples/projects/async-result/main.ts?raw';
import resultApp from '../../examples/projects/async-result/app.ts?raw';
import { lessonSource, type PlaygroundProject } from './project-types';

export const extensionLessons: readonly PlaygroundProject[] = [
  {
    id: 'transform-input',
    title: 'Add callback input',
    description:
      'A custom transformInput adds prefix and Module metadata before Greeting runs. Its original dependency context is preserved.',
    exercise:
      "Change prefix from 'Hello' to 'Welcome' in factory.ts and run. app.ts does not need either generated field.",
    concept: 'transformInput + withModuleName',
    section: 'Extensions',
    expectedOutput: 'Greeting: Hello, Alex!',
    docs: '/module/transform-input/',
    note: 'A custom input transform replaces the default. This factory explicitly uses withModuleName to keep Module.name.',
    entry: '/app.ts',
    activeFile: '/factory.ts',
    files: {
      '/factory.ts': lessonSource(inputFactory),
      '/greeting.ts': lessonSource(inputGreeting),
      '/app.ts': lessonSource(inputApp),
    },
  },
  {
    id: 'transform-output',
    title: 'Wrap a returned value',
    description:
      'Greeting returns a string. transformOutput turns that result into a box. Compare a direct call with Greeting resolved inside Main.',
    exercise:
      'Change the greeting text in greeting.ts and run. Read the transformed value through box.value in app.ts.',
    concept: 'transformOutput',
    section: 'Extensions',
    expectedOutput: 'Hello, Alex!\nroot: true\nnested: false',
    docs: '/module/transform-output/#ordinary-transforms-define-a-concrete-output-type',
    note: 'isRoot is true for a direct call and false for a resolved provider. transformOutput runs after the callback returns; it cannot catch a callback that already threw.',
    entry: '/app.ts',
    activeFile: '/factory.ts',
    files: {
      '/factory.ts': lessonSource(outputFactory),
      '/greeting.ts': lessonSource(outputGreeting),
      '/app.ts': lessonSource(outputApp),
    },
  },
  {
    id: 'output-hkt',
    title: 'Preserve output types with HKT',
    description:
      'BoxHKT wraps the exact callback result type. TModule keeps the module name and dependency requirements, so Score still needs base and returns a boxed number.',
    exercise:
      'Change the Score callback to ({ base }) => ({ total: base + 1 }), then use box.value.total.toFixed(0) in app.ts. The box now contains that object type.',
    concept: 'Output HKT',
    section: 'Extensions',
    expectedOutput: 'Score: 42',
    docs: '/module/transform-output/#use-an-hkt-for-a-static-result-transformation',
    note: 'An output HKT describes the complete callable module using TModule, while transformOutput returns only the boxed value. The HKT cast does not verify the runtime implementation.',
    entry: '/app.ts',
    activeFile: '/factory.ts',
    files: {
      '/factory.ts': lessonSource(outputHktFactory),
      '/score.ts': lessonSource(outputHktScore),
      '/app.ts': lessonSource(outputHktApp),
    },
  },
  {
    id: 'input-hkt',
    title: 'Wrap callback input with HKT',
    description:
      'WrappedInput changes the callback input to { wrapped: Deps }. Sum reads wrapped.left and wrapped.right; callers still supply the original dependency map.',
    exercise:
      'Rename wrapped to input in both the HKT type and the runtime transform, then update Sum to read input.left and input.right.',
    concept: 'Input HKT',
    section: 'Extensions',
    expectedOutput: '42',
    docs: '/module/transform-input/#preserving-versus-replacing-the-input',
    note: 'The input HKT receives the declared dependency type in _DEPS. Its cast does not check that the returned object matches the wrapper described by the type.',
    entry: '/app.ts',
    activeFile: '/factory.ts',
    files: {
      '/factory.ts': lessonSource(inputHktFactory),
      '/sum.ts': lessonSource(inputHktSum),
      '/app.ts': lessonSource(inputHktApp),
    },
  },
  {
    id: 'async-result',
    title: 'Return typed async results',
    description:
      'Wrap one User service: its async Load returns a typed Result. Main narrows ok before reading the user or handling the error.',
    exercise:
      "Make getUser throw new Error('API unavailable') in app.ts. Run again: Main prints the error message through the failure branch.",
    concept: 'Output HKT + async Result',
    section: 'Extensions',
    expectedOutput: 'Alex',
    docs: '/module/transform-output/#return-typed-api-results',
    note: 'The wrapper catches failures when Load executes. A failure while constructing the User service happens before transformOutput and is not caught here.',
    entry: '/app.ts',
    activeFile: '/main.ts',
    files: {
      '/main.ts': lessonSource(resultMain),
      '/factory.ts': lessonSource(resultFactory),
      '/app.ts': lessonSource(resultApp),
    },
  },
];
