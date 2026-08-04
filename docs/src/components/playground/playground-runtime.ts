import type {
  SandboxSetup,
  SandpackBundlerFile,
  SandpackMessage,
} from '@codesandbox/sandpack-client';

export const RUN_COMPLETE_PREFIX = '__FAVY_PLAYGROUND_DONE__:';
export const RUN_OUTPUT_PREFIX = '__FAVY_PLAYGROUND_OUTPUT__:';

type ConsoleRecord = Readonly<{
  method?: unknown;
  data?: readonly unknown[];
}>;

export type RunOutputRecord = Readonly<{
  token: number;
  method: string;
  data: readonly unknown[];
}>;

const CONSOLE_METHODS = new Set([
  'assert',
  'clear',
  'count',
  'debug',
  'error',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'warn',
]);

const PACKAGE_NAME =
  /^(?:@[-A-Za-z\d][A-Za-z\d._~-]*\/)?[-A-Za-z\d][A-Za-z\d._~-]*$/;

export const warmupSource = (dependencies: readonly string[]): string =>
  dependencies
    .map((dependency) => {
      if (dependency.length > 214 || !PACKAGE_NAME.test(dependency)) {
        throw new TypeError('Warmup dependencies must be npm package names.');
      }
      return `import ${JSON.stringify(dependency)};`;
    })
    .join('\n');

export const runSource = (token: number): string =>
  [
    `void import('/execution.ts?run=${token}').finally(() => {`,
    `  console.debug('${RUN_COMPLETE_PREFIX}${token}');`,
    '});',
    '',
  ].join('\n');

const executionSource = (code: string, token: number): string =>
  [
    'const __favyPlaygroundNativeConsole = globalThis.console;',
    'const console = new Proxy(__favyPlaygroundNativeConsole, {',
    '  get(target, property, receiver) {',
    '    const value = Reflect.get(target, property, receiver);',
    "    if (typeof value !== 'function') return value;",
    '    return (...data) => {',
    `      target.debug('${RUN_OUTPUT_PREFIX}${token}', String(property), ...data);`,
    '    };',
    '  },',
    '});',
    code,
    `// run:${token}`,
    '',
  ].join('\n');

export const setupForRun = (
  setup: SandboxSetup,
  code: string,
  token: number
): SandboxSetup => {
  const indexFile: SandpackBundlerFile = {
    ...setup.files['/index.ts'],
    code,
  };
  const executionFile: SandpackBundlerFile = {
    ...setup.files['/execution.ts'],
    code: executionSource(code, token),
  };
  const runnerFile: SandpackBundlerFile = {
    ...setup.files['/runner.ts'],
    code: runSource(token),
  };

  return {
    ...setup,
    files: {
      ...setup.files,
      '/index.ts': indexFile,
      '/execution.ts': executionFile,
      '/runner.ts': runnerFile,
    },
  };
};

export const completionToken = ({
  method,
  data,
}: ConsoleRecord): number | undefined => {
  if (method !== 'debug' || data?.length !== 1) return undefined;
  const value = data[0];
  if (typeof value !== 'string' || !value.startsWith(RUN_COMPLETE_PREFIX)) {
    return undefined;
  }

  const suffix = value.slice(RUN_COMPLETE_PREFIX.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const token = Number(suffix);
  return Number.isSafeInteger(token) ? token : undefined;
};

export const runOutputRecord = ({
  method,
  data,
}: ConsoleRecord): RunOutputRecord | undefined => {
  if (method !== 'debug' || !data || data.length < 2) return undefined;
  const marker = data[0];
  const outputMethod = data[1];
  if (
    typeof marker !== 'string' ||
    !marker.startsWith(RUN_OUTPUT_PREFIX) ||
    typeof outputMethod !== 'string' ||
    !CONSOLE_METHODS.has(outputMethod)
  ) {
    return undefined;
  }

  const suffix = marker.slice(RUN_OUTPUT_PREFIX.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const token = Number(suffix);
  if (!Number.isSafeInteger(token)) return undefined;
  return { token, method: outputMethod, data: data.slice(2) };
};

export const preparationLabel = (
  message: SandpackMessage
): string | undefined => {
  if (
    !('data' in message) ||
    typeof message.data !== 'object' ||
    message.data === null ||
    !('state' in message.data)
  ) {
    return undefined;
  }

  if (message.type === 'dependencies') {
    if (message.data.state === 'downloading_manifest') {
      return 'Downloading packages';
    }
    if (message.data.state === 'starting') return 'Installing packages';
  }
  if (
    message.type === 'shell/progress' &&
    message.data.state === 'starting_command'
  ) {
    return 'Starting Vite';
  }
  return undefined;
};
