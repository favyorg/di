import generatorTypes from '../../examples/projects/generator-services/types.ts?raw';
import generatorContracts from '../../examples/projects/generator-services/contracts.ts?raw';
import generatorFormatters from '../../examples/projects/generator-services/formatters.ts?raw';
import generatorStyles from '../../examples/projects/generator-services/styles.css?raw';
import generatorApp from '../../examples/projects/generator-services/app.ts?raw';
import generatorHtml from '../../examples/projects/generator-services/index.html?raw';
import generatorMain from '../../examples/projects/generator-services/main.ts?raw';
import httpTypes from '../../examples/projects/http-handler/types.ts?raw';
import httpApp from '../../examples/projects/http-handler/app.ts?raw';
import httpHtml from '../../examples/projects/http-handler/index.html?raw';
import httpMain from '../../examples/projects/http-handler/main.ts?raw';
import httpStore from '../../examples/projects/http-handler/store.ts?raw';
import httpStyles from '../../examples/projects/http-handler/styles.css?raw';
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
    .replace('../shared/styles.css', './styles.css');
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
    title: 'URL shortener API',
    description:
      'Build a stateful API with ordinary modules. Create short links, follow redirects, and count visits in an injected store.',
    kind: 'backend',
    entry: '/src/app.ts',
    activeFile: '/src/main.ts',
    files: {
      '/index.html': httpHtml,
      '/src/app.ts': source(httpApp),
      '/src/main.ts': source(httpMain),
      '/src/types.ts': httpTypes,
      '/src/store.ts': source(httpStore),
      '/src/styles.css': httpStyles.replace(
        "@import '../shared/styles.css';",
        styles
      ),
    },
    dependencies: {},
  },
  {
    id: 'generator-services',
    title: 'Document formatter',
    description:
      'Edit a document, swap HTML and plain-text implementations of a Formatter tag, and download the generated file.',
    kind: 'console',
    entry: '/src/app.ts',
    activeFile: '/src/main.ts',
    files: {
      '/index.html': generatorHtml,
      '/src/app.ts': source(generatorApp),
      '/src/main.ts': source(generatorMain),
      '/src/types.ts': generatorTypes,
      '/src/contracts.ts': source(generatorContracts),
      '/src/formatters.ts': source(generatorFormatters),
      '/src/styles.css': generatorStyles.replace(
        "@import '../shared/styles.css';",
        styles
      ),
    },
    dependencies: {},
  },
];

export const projectById: Readonly<Record<string, PlaygroundProject>> =
  Object.fromEntries(
    playgroundProjects.map((project) => [project.id, project])
  );
