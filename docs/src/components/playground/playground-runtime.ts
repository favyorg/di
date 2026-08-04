import type {
  SandboxSetup,
  SandpackBundlerFile,
  SandpackMessage,
} from '@codesandbox/sandpack-client';

export const RUN_COMPLETE_PREFIX = '__FAVY_PLAYGROUND_DONE__:';
export const RUN_ERROR_PREFIX = '__FAVY_PLAYGROUND_ERROR__:';
export const RUN_OUTPUT_PREFIX = '__FAVY_PLAYGROUND_OUTPUT__:';

const RUN_BRIDGE_KEY = '__favyPlaygroundRunBridge__';
const RUN_FRAME_KEY = '__favyPlaygroundExecutionFrame__';
const RUN_FRAME_ATTRIBUTE = 'data-favy-playground-execution';
const RUN_COMPLETE_METHOD = '__favyPlaygroundComplete__';
const RUN_ERROR_METHOD = '__favyPlaygroundError__';

type ConsoleRecord = Readonly<{
  method?: unknown;
  data?: readonly unknown[];
}>;

export type RunOutputRecord = Readonly<{
  token: number;
  method: string;
  data: readonly unknown[];
}>;

export type RunErrorRecord = Readonly<{
  token: number;
  error: unknown;
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

const childBootstrap = (token: number): string =>
  [
    "'use strict';",
    `const bridgeKey = ${JSON.stringify(RUN_BRIDGE_KEY)};`,
    `const completeMethod = ${JSON.stringify(RUN_COMPLETE_METHOD)};`,
    `const errorMethod = ${JSON.stringify(RUN_ERROR_METHOD)};`,
    "const truncated = '[Truncated]';",
    "const unserializable = '[Unserializable value]';",
    'const maxDepth = 6;',
    'const maxVisits = 64;',
    'const maxStringBytes = 256;',
    'const maxOutputBytes = 4096;',
    'const boundedText = (value, byteLimit) => {',
    '  let bytes = 0;',
    '  let end = 0;',
    '  let truncatedEnd = 0;',
    '  while (end < value.length) {',
    '    const codePoint = value.codePointAt(end);',
    '    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;',
    '    if (bytes + size > byteLimit) return value.slice(0, truncatedEnd) + truncated;',
    '    bytes += size;',
    '    end += codePoint > 0xffff ? 2 : 1;',
    '    if (bytes <= byteLimit - truncated.length) truncatedEnd = end;',
    '  }',
    '  return value;',
    '};',
    'const ownData = (value, key) => {',
    '  try {',
    '    const descriptor = Object.getOwnPropertyDescriptor(value, key);',
    "    return descriptor && 'value' in descriptor ? descriptor.value : undefined;",
    '  } catch {',
    '    return undefined;',
    '  }',
    '};',
    'const specialObject = (value) => {',
    '  try {',
    "    const stack = Object.getOwnPropertyDescriptor(value, 'stack');",
    '    if (stack) {',
    "      if ('value' in stack && typeof stack.value === 'string') return stack.value;",
    "      const message = ownData(value, 'message');",
    "      const ownName = ownData(value, 'name');",
    '      const prototype = Object.getPrototypeOf(value);',
    "      const inheritedName = prototype && ownData(prototype, 'name');",
    "      const name = typeof ownName === 'string' ? ownName : typeof inheritedName === 'string' ? inheritedName : 'Error';",
    "      return typeof message === 'string' && message ? `${name}: ${message}` : name;",
    '    }',
    '  } catch {}',
    '  try {',
    '    const time = Date.prototype.getTime.call(value);',
    "    return Number.isNaN(time) ? 'Invalid Date' : new Date(time).toISOString();",
    '  } catch {}',
    '  try {',
    "    const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(value);",
    '    const flags = [',
    "      ['d', 'hasIndices'], ['g', 'global'], ['i', 'ignoreCase'],",
    "      ['m', 'multiline'], ['s', 'dotAll'], ['u', 'unicode'],",
    "      ['v', 'unicodeSets'], ['y', 'sticky'],",
    '    ].flatMap(([flag, key]) => {',
    '      const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, key);',
    '      return descriptor && descriptor.get && descriptor.get.call(value) ? [flag] : [];',
    "    }).join('');",
    '    return `/${source}/${flags}`;',
    '  } catch {',
    '    return undefined;',
    '  }',
    '};',
    'const snapshot = (value, seen, budget, depth) => {',
    '  if (depth >= maxDepth || budget.visits >= maxVisits) return truncated;',
    '  budget.visits += 1;',
    '  if (value === null) return null;',
    '  const type = typeof value;',
    "  if (type === 'string') return boundedText(value, depth === 0 ? maxOutputBytes : maxStringBytes);",
    "  if (type === 'number' || type === 'boolean') return value;",
    "  if (type === 'undefined') return '[undefined]';",
    "  if (type === 'bigint') return `${value}n`;",
    "  if (type === 'symbol') return String(value);",
    "  if (type === 'function') return '[Function]';",
    '  const special = specialObject(value);',
    '  if (special !== undefined) return boundedText(special, depth === 0 ? maxOutputBytes : maxStringBytes);',
    "  if (seen.has(value)) return '[Circular]';",
    '  seen.add(value);',
    '  try {',
    '    const array = Array.isArray(value);',
    '    const result = array ? [] : Object.create(null);',
    '    for (const key in value) {',
    '      if (budget.visits >= maxVisits) {',
    '        if (array) result.push(truncated);',
    "        else Object.defineProperty(result, '...', { configurable: true, enumerable: true, value: truncated });",
    '        break;',
    '      }',
    '      budget.visits += 1;',
    '      const descriptor = Object.getOwnPropertyDescriptor(value, key);',
    '      if (!descriptor || !descriptor.enumerable) continue;',
    "      const item = 'value' in descriptor",
    '        ? snapshot(descriptor.value, seen, budget, depth + 1)',
    "        : '[Getter]';",
    '      if (array) result.push(item);',
    '      else Object.defineProperty(result, boundedText(key, 80), { configurable: true, enumerable: true, value: item });',
    '    }',
    '    return result;',
    '  } catch {',
    '    return unserializable;',
    '  }',
    '};',
    'const normalize = (value) => {',
    '  if (value === null) return null;',
    '  const type = typeof value;',
    "  if (type === 'string') return boundedText(value, maxOutputBytes);",
    "  if (type === 'number' || type === 'boolean' || type === 'undefined') return value;",
    '  try {',
    '    const valueSnapshot = snapshot(value, new WeakSet(), { visits: 0 }, 0);',
    "    const serialized = typeof valueSnapshot === 'string' ? valueSnapshot : JSON.stringify(valueSnapshot);",
    '    return boundedText(serialized, maxOutputBytes);',
    '  } catch {',
    '    return unserializable;',
    '  }',
    '};',
    'const send = function () {',
    '  const bridge = Reflect.get(parent, bridgeKey);',
    "  if (typeof bridge !== 'function') return;",
    '  bridge(window, arguments[0], Array.from(arguments).slice(1).map(normalize));',
    '};',
    'const reportedErrors = new Set();',
    'const reportError = (error) => {',
    '  const normalized = normalize(error);',
    '  const key = `${typeof normalized}:${String(normalized)}`;',
    '  if (reportedErrors.has(key)) return;',
    '  reportedErrors.add(key);',
    '  send(errorMethod, normalized);',
    '};',
    "globalThis.addEventListener('error', (event) => {",
    '  reportError(event.error === undefined ? event.message : event.error);',
    '  event.preventDefault();',
    '});',
    "globalThis.addEventListener('unhandledrejection', (event) => {",
    '  reportError(event.reason);',
    '  event.preventDefault();',
    '});',
    'const counts = new Map();',
    'const timers = new Map();',
    'const nativeConsole = globalThis.console;',
    'const runConsole = Object.create(nativeConsole);',
    'Object.assign(runConsole, {',
    "  debug: (...data) => send('debug', ...data),",
    "  error: (...data) => send('error', ...data),",
    "  info: (...data) => send('info', ...data),",
    "  log: (...data) => send('log', ...data),",
    "  table: (...data) => send('table', ...data),",
    "  warn: (...data) => send('warn', ...data),",
    '  assert: (condition, ...data) => {',
    '    if (condition) return;',
    '    const assertion =',
    "      data.length === 0 ? ['Assertion failed'] : ['Assertion failed:', ...data];",
    "    send('assert', ...assertion);",
    '  },',
    "  clear: () => send('clear'),",
    "  count: (label = 'default') => {",
    '    const key = String(label);',
    '    const value = (counts.get(key) ?? 0) + 1;',
    '    counts.set(key, value);',
    "    send('count', `${key}: ${value}`);",
    '  },',
    "  time: (label = 'default') => {",
    '    const key = String(label);',
    '    if (timers.has(key)) return;',
    '    timers.set(key, performance.now());',
    '  },',
    "  timeEnd: (label = 'default') => {",
    '    const key = String(label);',
    '    const start = timers.get(key);',
    '    if (start === undefined) return;',
    '    timers.delete(key);',
    "    send('timeEnd', `${key}: ${performance.now() - start}ms`);",
    '  },',
    '});',
    "Object.defineProperty(globalThis, 'console', {",
    '  configurable: true,',
    '  writable: true,',
    '  value: runConsole,',
    '});',
    `void import('/execution.ts?run=${token}').then(`,
    '  () => globalThis.setTimeout(() => send(completeMethod), 0),',
    '  (error) => {',
    '    reportError(error);',
    '    send(completeMethod);',
    '  }',
    ');',
    '',
  ].join('\n');

export const runSource = (token: number): string => {
  const srcdoc = `<!doctype html><script type="module">${childBootstrap(
    token
  )}</script>`;
  return [
    `const previousFrame = Reflect.get(globalThis, ${JSON.stringify(
      RUN_FRAME_KEY
    )});`,
    "if (previousFrame && typeof previousFrame.remove === 'function') {",
    '  previousFrame.remove();',
    '}',
    "const frame = document.createElement('iframe');",
    'frame.hidden = true;',
    "frame.setAttribute('aria-hidden', 'true');",
    `frame.setAttribute(${JSON.stringify(
      RUN_FRAME_ATTRIBUTE
    )}, ${JSON.stringify(String(token))});`,
    'const parentConsole = globalThis.console;',
    `Object.defineProperty(globalThis, ${JSON.stringify(RUN_BRIDGE_KEY)}, {`,
    '  configurable: true,',
    '  value: function () {',
    '    const source = arguments[0];',
    '    const method = arguments[1];',
    '    const data = arguments[2];',
    '    if (source !== frame.contentWindow || !Array.isArray(data)) return;',
    `    if (method === ${JSON.stringify(RUN_COMPLETE_METHOD)}) {`,
    `      parentConsole.debug(${JSON.stringify(
      RUN_COMPLETE_PREFIX + token
    )});`,
    '      return;',
    '    }',
    `    if (method === ${JSON.stringify(RUN_ERROR_METHOD)}) {`,
    `      parentConsole.debug(${JSON.stringify(
      RUN_ERROR_PREFIX + token
    )}, data[0]);`,
    '      return;',
    '    }',
    `    parentConsole.debug(${JSON.stringify(
      RUN_OUTPUT_PREFIX + token
    )}, method, ...data);`,
    '  },',
    '});',
    `frame.srcdoc = ${JSON.stringify(srcdoc)};`,
    'document.body.append(frame);',
    `Reflect.set(globalThis, ${JSON.stringify(RUN_FRAME_KEY)}, frame);`,
    '',
  ].join('\n');
};

const executionSource = (code: string, token: number): string =>
  [code, `// run:${token}`, ''].join('\n');

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

export const runErrorRecord = ({
  method,
  data,
}: ConsoleRecord): RunErrorRecord | undefined => {
  if (method !== 'debug' || data?.length !== 2) return undefined;
  const marker = data[0];
  if (typeof marker !== 'string' || !marker.startsWith(RUN_ERROR_PREFIX)) {
    return undefined;
  }

  const suffix = marker.slice(RUN_ERROR_PREFIX.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const token = Number(suffix);
  return Number.isSafeInteger(token) ? { token, error: data[1] } : undefined;
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
