import type {
  SandboxSetup,
  SandpackBundlerFile,
  SandpackMessage,
} from '@codesandbox/sandpack-client';

export const RUN_COMPLETE_PREFIX = '__FAVY_PLAYGROUND_DONE__:';

type ConsoleRecord = Readonly<{
  method?: unknown;
  data?: readonly unknown[];
}>;

export const warmupSource = (dependencies: readonly string[]): string =>
  dependencies.map((dependency) => `import '${dependency}';`).join('\n');

export const runSource = (token: number): string =>
  [
    `void import('/execution.ts?run=${token}').finally(() => {`,
    `  console.debug('${RUN_COMPLETE_PREFIX}${token}');`,
    '});',
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
    code: code + '\n// run:' + token + '\n',
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
