import counter from '../../examples/projects/frontend/counter.ts?raw';
import frontendApp from '../../examples/projects/frontend/app.ts?raw';
import html from '../../examples/projects/frontend/index.html?raw';
import user from '../../examples/projects/backend/user.ts?raw';
import handler from '../../examples/projects/backend/handler.ts?raw';
import backendApp from '../../examples/projects/backend/app.ts?raw';
import { lessonSource, type PlaygroundProject } from './project-types';

export const applicationLessons: readonly PlaygroundProject[] = [
  {
    id: 'frontend',
    title: 'Connect a button',
    description:
      'Counter owns the state. app.ts creates one instance and connects its Increment method to a browser click handler.',
    exercise:
      'Change step from 1 to 2 in app.ts, run again, and click Increment twice.',
    concept: 'Frontend',
    section: 'Applications',
    expectedOutput:
      'The count starts at 0. Each click adds 1; after the exercise, two clicks show 4.',
    docs: '/guides/best-practices/',
    note: 'Create the service once when wiring the page. Calling Counter inside the click handler would create new state on every click.',
    preview: 'browser',
    entry: '/app.ts',
    activeFile: '/app.ts',
    files: {
      '/app.ts': frontendApp,
      '/counter.ts': lessonSource(counter),
      '/index.html': html,
    },
  },
  {
    id: 'backend',
    title: 'Handle a request',
    description:
      'Handler receives a Request and returns a Response. Modules are created synchronously; their Load and Handle methods do the async work.',
    exercise:
      'Change the name in app.ts to Sam and the request path to /profile. Run to inspect the new response.',
    concept: 'Async methods',
    section: 'Applications',
    expectedOutput: '200\n{"path": "/user", "user": {"name": "Alex"}}',
    docs: '/guides/best-practices/#keep-dependency-boundaries-explicit',
    note: 'Request and Response run locally in the browser. This example does not send a network request or start a server.',
    entry: '/app.ts',
    activeFile: '/handler.ts',
    files: {
      '/handler.ts': lessonSource(handler),
      '/user.ts': lessonSource(user),
      '/app.ts': backendApp,
    },
  },
];
