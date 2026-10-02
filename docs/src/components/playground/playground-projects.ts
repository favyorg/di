import generatorApiTypes from '../../examples/api-result/api-types.ts?raw';
import generatorContracts from '../../examples/generator/contracts.ts?raw';
import generatorServices from '../../examples/generator/loaders.ts?raw';
import generatorApp from '../../examples/projects/generator-services/app.ts?raw';
import generatorHtml from '../../examples/projects/generator-services/index.html?raw';
import generatorMain from '../../examples/projects/generator-services/main.ts?raw';
import httpApiTypes from '../../examples/projects/http-handler/api-types.ts?raw';
import httpApp from '../../examples/projects/http-handler/app.ts?raw';
import httpContracts from '../../examples/projects/http-handler/contracts.ts?raw';
import httpHtml from '../../examples/projects/http-handler/index.html?raw';
import httpMain from '../../examples/projects/http-handler/main.ts?raw';
import httpMockData from '../../examples/projects/http-handler/mock-data.ts?raw';
import httpRepository from '../../examples/projects/http-handler/repository.ts?raw';
import reactApiTypes from '../../examples/projects/react-orders/api-types.ts?raw';
import reactApp from '../../examples/projects/react-orders/app.tsx?raw';
import reactContracts from '../../examples/projects/react-orders/contracts.ts?raw';
import reactDashboard from '../../examples/projects/react-orders/dashboard.tsx?raw';
import reactHtml from '../../examples/projects/react-orders/index.html?raw';
import reactMain from '../../examples/projects/react-orders/main.ts?raw';
import reactServices from '../../examples/projects/react-orders/services.ts?raw';
import styles from '../../examples/projects/shared/styles.css?raw';

export type PlaygroundProject = Readonly<{
  id: string;
  title: string;
  description: string;
  kind: 'frontend' | 'backend' | 'console';
  entry: string;
  activeFile: string;
  files: Readonly<Record<string, string>>;
  dependencies: Readonly<Record<string, string>>;
}>;

function source(code: string): string {
  return code
    .replace(/(?:\.\.\/)+di\/src/g, '@favy/di')
    .replace('../shared/styles.css', './styles.css')
    .replace('../../generator/contracts', './services/contracts')
    .replace('../../generator/loaders', './services/loaders')
    .replace('../../api-result/api-types', './api-types');
}

export const playgroundProjects: readonly PlaygroundProject[] = [
  {
    id: 'react-orders',
    title: 'React orders dashboard',
    description:
      'Inject User and Orders services into a React dashboard. Load data, simulate an API failure, and recover.',
    kind: 'frontend',
    entry: '/src/app.tsx',
    activeFile: '/src/main.ts',
    files: {
      '/index.html': reactHtml,
      '/src/app.tsx': source(reactApp),
      '/src/main.ts': source(reactMain).replace(
        "'./contracts'",
        "'./services/contracts'"
      ),
      '/src/dashboard.tsx': reactDashboard,
      '/src/api-types.ts': reactApiTypes,
      '/src/services/contracts.ts': source(reactContracts).replace(
        "'./api-types'",
        "'../api-types'"
      ),
      '/src/services/index.ts': source(reactServices).replace(
        "'./api-types'",
        "'../api-types'"
      ),
      '/src/styles.css': styles,
    },
    dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
  },
  {
    id: 'http-handler',
    title: 'HTTP handler and repository',
    description:
      'Run a Request → Response handler with a mock repository. Try successful requests and a missing user.',
    kind: 'backend',
    entry: '/src/app.ts',
    activeFile: '/src/main.ts',
    files: {
      '/index.html': httpHtml,
      '/src/app.ts': source(httpApp).replace(
        "'./repository'",
        "'./services/repository'"
      ),
      '/src/main.ts': source(httpMain).replace(
        "'./contracts'",
        "'./services/contracts'"
      ),
      '/src/api-types.ts': httpApiTypes,
      '/src/mock-data.ts': httpMockData,
      '/src/services/contracts.ts': source(httpContracts).replace(
        "'./api-types'",
        "'../api-types'"
      ),
      '/src/services/repository.ts': source(httpRepository).replace(
        "'./api-types'",
        "'../api-types'"
      ),
      '/src/styles.css': styles,
    },
    dependencies: {},
  },
  {
    id: 'generator-services',
    title: 'Generator service composition',
    description:
      'Request contracts with yield*, bind implementations with .provide(), and inspect the composed result.',
    kind: 'console',
    entry: '/src/app.ts',
    activeFile: '/src/main.ts',
    files: {
      '/index.html': generatorHtml,
      '/src/app.ts': source(generatorApp),
      '/src/main.ts': source(generatorMain),
      '/src/api-types.ts': generatorApiTypes,
      '/src/services/contracts.ts': source(generatorContracts).replace(
        "'../api-result/api-types'",
        "'../api-types'"
      ),
      '/src/services/loaders.ts': source(generatorServices).replace(
        "'../api-result/api-types'",
        "'../api-types'"
      ),
      '/src/styles.css': styles,
    },
    dependencies: {},
  },
];

export const projectById: Readonly<Record<string, PlaygroundProject>> =
  Object.fromEntries(
    playgroundProjects.map((project) => [project.id, project])
  );
