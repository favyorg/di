import type {
  SandboxSetup,
  SandpackBundlerFile,
  SandpackMessage,
} from '@codesandbox/sandpack-client';
import { isNpmPackageName } from './playground-dependencies';

const RUNTIME_MESSAGE_TYPE = '__FAVY_PLAYGROUND_RUNTIME__';
const RUNTIME_RELAY_MARKER = '__FAVY_PLAYGROUND_RELAY__';

type ConsoleRecord = Readonly<{
  method?: unknown;
  data?: readonly unknown[];
}>;

export type PlaygroundConsoleValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type RuntimeConsoleMethod =
  | 'assert'
  | 'clear'
  | 'count'
  | 'debug'
  | 'error'
  | 'info'
  | 'log'
  | 'table'
  | 'time'
  | 'timeEnd'
  | 'warn';

export type RuntimeCommand =
  | Readonly<{
      type: '__FAVY_PLAYGROUND_RUNTIME__';
      action: 'prepare';
      sessionToken: number;
    }>
  | Readonly<{
      type: '__FAVY_PLAYGROUND_RUNTIME__';
      action: 'run' | 'cancel';
      sessionToken: number;
      runToken: number;
    }>;

export type RuntimeRelay =
  | { kind: 'ready'; sessionToken: number }
  | {
      kind: 'prepareError';
      sessionToken: number;
      error: PlaygroundConsoleValue;
    }
  | {
      kind: 'output';
      sessionToken: number;
      runToken: number;
      eventId: number;
      method: RuntimeConsoleMethod;
      data: readonly PlaygroundConsoleValue[];
    }
  | {
      kind: 'error';
      sessionToken: number;
      runToken: number;
      eventId: number;
      error: PlaygroundConsoleValue;
    }
  | { kind: 'complete'; sessionToken: number; runToken: number }
  | { kind: 'cancelled'; sessionToken: number; runToken: number };

const CONSOLE_METHODS = new Set<RuntimeConsoleMethod>([
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

export const warmupSource = (dependencies: readonly string[]): string =>
  dependencies
    .map((dependency) => {
      if (!isNpmPackageName(dependency)) {
        throw new TypeError('Warmup dependencies must be npm package names.');
      }
      return `import ${JSON.stringify(dependency)};`;
    })
    .join('\n');

export const runtimePrepareCommand = (
  sessionToken: number
): RuntimeCommand => ({
  type: RUNTIME_MESSAGE_TYPE,
  action: 'prepare',
  sessionToken,
});

export const runtimeRunCommand = (
  sessionToken: number,
  runToken: number
): RuntimeCommand => ({
  type: RUNTIME_MESSAGE_TYPE,
  action: 'run',
  sessionToken,
  runToken,
});

export const runtimeCancelCommand = (
  sessionToken: number,
  runToken: number
): RuntimeCommand => ({
  type: RUNTIME_MESSAGE_TYPE,
  action: 'cancel',
  sessionToken,
  runToken,
});

const isToken = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const utf8Bytes = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
        ? 3
        : 4;
    if (codePoint > 0xffff) index += 1;
  }
  return bytes;
};

const isConsoleValue = (value: unknown): value is PlaygroundConsoleValue =>
  value === null ||
  value === undefined ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  (typeof value === 'string' && utf8Bytes(value) <= 4_096);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean => {
  try {
    const keys = Object.keys(value);
    return (
      keys.length === expected.length &&
      expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    );
  } catch {
    return false;
  }
};

const parseRuntimeRelay = (value: unknown): RuntimeRelay | undefined => {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'ready') {
    return hasExactKeys(value, ['kind', 'sessionToken']) &&
      isToken(value.sessionToken)
      ? { kind: 'ready', sessionToken: value.sessionToken }
      : undefined;
  }
  if (value.kind === 'prepareError') {
    return hasExactKeys(value, ['kind', 'sessionToken', 'error']) &&
      isToken(value.sessionToken) &&
      isConsoleValue(value.error)
      ? {
          kind: 'prepareError',
          sessionToken: value.sessionToken,
          error: value.error,
        }
      : undefined;
  }
  if (value.kind === 'output') {
    if (
      !hasExactKeys(value, [
        'kind',
        'sessionToken',
        'runToken',
        'eventId',
        'method',
        'data',
      ]) ||
      !isToken(value.sessionToken) ||
      !isToken(value.runToken) ||
      !isToken(value.eventId) ||
      typeof value.method !== 'string' ||
      !CONSOLE_METHODS.has(value.method as RuntimeConsoleMethod) ||
      !Array.isArray(value.data) ||
      value.data.length > 20 ||
      !value.data.every(isConsoleValue)
    ) {
      return undefined;
    }
    return {
      kind: 'output',
      sessionToken: value.sessionToken,
      runToken: value.runToken,
      eventId: value.eventId,
      method: value.method as RuntimeConsoleMethod,
      data: value.data as PlaygroundConsoleValue[],
    };
  }
  if (value.kind === 'error') {
    return hasExactKeys(value, [
      'kind',
      'sessionToken',
      'runToken',
      'eventId',
      'error',
    ]) &&
      isToken(value.sessionToken) &&
      isToken(value.runToken) &&
      isToken(value.eventId) &&
      isConsoleValue(value.error)
      ? {
          kind: 'error',
          sessionToken: value.sessionToken,
          runToken: value.runToken,
          eventId: value.eventId,
          error: value.error,
        }
      : undefined;
  }
  if (value.kind === 'complete' || value.kind === 'cancelled') {
    return hasExactKeys(value, ['kind', 'sessionToken', 'runToken']) &&
      isToken(value.sessionToken) &&
      isToken(value.runToken)
      ? {
          kind: value.kind,
          sessionToken: value.sessionToken,
          runToken: value.runToken,
        }
      : undefined;
  }
  return undefined;
};

export const runtimeRelayRecord = ({
  method,
  data,
}: ConsoleRecord): RuntimeRelay | undefined => {
  if (
    method !== 'debug' ||
    data?.length !== 2 ||
    data[0] !== RUNTIME_RELAY_MARKER
  ) {
    return undefined;
  }
  return parseRuntimeRelay(data[1]);
};

const frameBootstrapSource = (): string =>
  [
    "'use strict';",
    '(() => {',
    `  const messageType = ${JSON.stringify(RUNTIME_MESSAGE_TYPE)};`,
    "  const truncated = '[Truncated]';",
    "  const unserializable = '[Unserializable value]';",
    '  const maxDepth = 6;',
    '  const maxVisits = 64;',
    '  const maxStringBytes = 256;',
    '  const maxOutputBytes = 4096;',
    '  const params = new URLSearchParams(globalThis.location.search);',
    "  const modeValues = params.getAll('mode');",
    "  const sessionValues = params.getAll('session');",
    "  const runValues = params.getAll('run');",
    '  const mode = modeValues.length === 1 ? modeValues[0] : undefined;',
    "  const parseToken = (value) => typeof value === 'string' && /^(?:0|[1-9]\\d*)$/.test(value)",
    '    ? Number(value)',
    '    : undefined;',
    '  const sessionToken = parseToken(sessionValues.length === 1 ? sessionValues[0] : undefined);',
    '  const runToken = parseToken(runValues.length === 1 ? runValues[0] : undefined);',
    "  const expectedKeys = mode === 'warmup' ? ['mode', 'session'] : mode === 'run' ? ['mode', 'session', 'run'] : [];",
    '  const queryKeys = Array.from(params.keys());',
    '  const validQuery = expectedKeys.length === queryKeys.length',
    '    && expectedKeys.every((key) => params.getAll(key).length === 1)',
    '    && Number.isSafeInteger(sessionToken)',
    '    && sessionToken >= 0',
    "    && (mode === 'warmup' ? runValues.length === 0 : Number.isSafeInteger(runToken) && runToken >= 0);",
    '  if (!validQuery) return;',
    '  let nextEventId = 0;',
    '  const takeEventId = () => {',
    '    if (!Number.isSafeInteger(nextEventId)) return undefined;',
    '    const eventId = nextEventId;',
    '    nextEventId += 1;',
    '    return eventId;',
    '  };',
    '  const boundedText = (value, byteLimit) => {',
    '    let bytes = 0;',
    '    let end = 0;',
    '    let truncatedEnd = 0;',
    '    while (end < value.length) {',
    '      const codePoint = value.codePointAt(end);',
    '      const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;',
    '      if (bytes + size > byteLimit) return value.slice(0, truncatedEnd) + truncated;',
    '      bytes += size;',
    '      end += codePoint > 0xffff ? 2 : 1;',
    '      if (bytes <= byteLimit - truncated.length) truncatedEnd = end;',
    '    }',
    '    return value;',
    '  };',
    '  const ownData = (value, key) => {',
    '    try {',
    '      const descriptor = Object.getOwnPropertyDescriptor(value, key);',
    "      return descriptor && 'value' in descriptor ? descriptor.value : undefined;",
    '    } catch {',
    '      return undefined;',
    '    }',
    '  };',
    '  const specialObject = (value) => {',
    '    try {',
    "      const stack = Object.getOwnPropertyDescriptor(value, 'stack');",
    '      if (stack) {',
    "        if ('value' in stack && typeof stack.value === 'string') return stack.value;",
    "        const message = ownData(value, 'message');",
    "        const ownName = ownData(value, 'name');",
    '        const prototype = Object.getPrototypeOf(value);',
    "        const inheritedName = prototype && ownData(prototype, 'name');",
    "        const name = typeof ownName === 'string' ? ownName : typeof inheritedName === 'string' ? inheritedName : 'Error';",
    "        return typeof message === 'string' && message ? `${name}: ${message}` : name;",
    '      }',
    '    } catch {}',
    '    try {',
    '      const time = Date.prototype.getTime.call(value);',
    "      return Number.isNaN(time) ? 'Invalid Date' : new Date(time).toISOString();",
    '    } catch {}',
    '    try {',
    "      const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(value);",
    '      const flags = [',
    "        ['d', 'hasIndices'], ['g', 'global'], ['i', 'ignoreCase'],",
    "        ['m', 'multiline'], ['s', 'dotAll'], ['u', 'unicode'],",
    "        ['v', 'unicodeSets'], ['y', 'sticky'],",
    '      ].flatMap(([flag, key]) => {',
    '        const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, key);',
    '        return descriptor && descriptor.get && descriptor.get.call(value) ? [flag] : [];',
    "      }).join('');",
    '      return `/${source}/${flags}`;',
    '    } catch {',
    '      return undefined;',
    '    }',
    '  };',
    '  const snapshot = (value, seen, budget, depth) => {',
    '    if (value === null) return null;',
    '    const type = typeof value;',
    "    if (type === 'string') return boundedText(value, depth === 0 ? maxOutputBytes : maxStringBytes);",
    "    if (type === 'number' || type === 'boolean') return value;",
    "    if (type === 'undefined') return '[undefined]';",
    "    if (type === 'bigint') return `${value}n`;",
    "    if (type === 'symbol') return String(value);",
    "    if (type === 'function') return '[Function]';",
    '    const special = specialObject(value);',
    '    if (special !== undefined) return boundedText(special, depth === 0 ? maxOutputBytes : maxStringBytes);',
    '    try {',
    "      if (!Array.isArray(value)) return '[Object]';",
    '      if (depth >= maxDepth || budget.visits >= maxVisits) return truncated;',
    "      if (seen.has(value)) return '[Circular]';",
    '      seen.add(value);',
    "      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');",
    "      if (!lengthDescriptor || !('value' in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return unserializable;",
    '      const length = lengthDescriptor.value;',
    '      const result = [];',
    '      let index = 0;',
    '      for (; index < length && budget.visits < maxVisits; index += 1) {',
    '        budget.visits += 1;',
    '        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));',
    "        const item = !descriptor ? '[empty]' : 'value' in descriptor",
    '          ? snapshot(descriptor.value, seen, budget, depth + 1)',
    "          : '[Getter]';",
    '        result.push(item);',
    '      }',
    '      if (index < length) result.push(truncated);',
    '      return result;',
    '    } catch {',
    '      return unserializable;',
    '    }',
    '  };',
    '  const normalize = (value) => {',
    '    if (value === null) return null;',
    '    const type = typeof value;',
    "    if (type === 'string') return boundedText(value, maxOutputBytes);",
    "    if (type === 'number' || type === 'boolean' || type === 'undefined') return value;",
    '    try {',
    '      const valueSnapshot = snapshot(value, new WeakSet(), { visits: 0 }, 0);',
    "      const serialized = typeof valueSnapshot === 'string' ? valueSnapshot : JSON.stringify(valueSnapshot);",
    '      return boundedText(serialized, maxOutputBytes);',
    '    } catch {',
    '      return unserializable;',
    '    }',
    '  };',
    '  const reportedErrors = new Set();',
    '  const send = (kind, value, data) => {',
    "    if (kind === 'ready') {",
    "      parent.postMessage({ type: messageType, kind, sessionToken }, '*');",
    '      return;',
    '    }',
    "    if (kind === 'prepareError') {",
    "      parent.postMessage({ type: messageType, kind, sessionToken, error: value }, '*');",
    '      return;',
    '    }',
    "    if (kind === 'complete') {",
    "      parent.postMessage({ type: messageType, kind, sessionToken, runToken }, '*');",
    '      return;',
    '    }',
    "    if (mode !== 'run') return;",
    "    if (kind === 'error') {",
    '      const key = `${typeof value}:${String(value)}`;',
    '      if (reportedErrors.has(key)) return;',
    '      reportedErrors.add(key);',
    '    }',
    '    const eventId = takeEventId();',
    '    if (eventId === undefined) return;',
    "    const record = kind === 'output'",
    '      ? { type: messageType, kind, sessionToken, runToken, eventId, method: value, data }',
    '      : { type: messageType, kind, sessionToken, runToken, eventId, error: value };',
    "    parent.postMessage(record, '*');",
    '  };',
    '  const sendOutput = (method, values) => {',
    "    if (mode !== 'run') return;",
    '    const data = values.length > 20',
    '      ? [...values.slice(0, 19).map(normalize), truncated]',
    '      : values.map(normalize);',
    "    send('output', method, data);",
    '  };',
    "  const reportError = (error) => send('error', normalize(error));",
    "  if (mode === 'run') {",
    "    globalThis.addEventListener('error', (event) => {",
    '      reportError(event.error === undefined ? event.message : event.error);',
    '      event.preventDefault();',
    '    });',
    "    globalThis.addEventListener('unhandledrejection', (event) => {",
    '      reportError(event.reason);',
    '      event.preventDefault();',
    '    });',
    '  }',
    '  const counts = new Map();',
    '  const timers = new Map();',
    '  const nativeConsole = globalThis.console;',
    '  const runConsole = Object.create(nativeConsole);',
    '  Object.assign(runConsole, {',
    "    debug: (...data) => sendOutput('debug', data),",
    "    error: (...data) => sendOutput('error', data),",
    "    info: (...data) => sendOutput('info', data),",
    "    log: (...data) => sendOutput('log', data),",
    "    table: (...data) => sendOutput('table', data),",
    "    warn: (...data) => sendOutput('warn', data),",
    '    assert: (condition, ...data) => {',
    '      if (condition) return;',
    "      const assertion = data.length === 0 ? ['Assertion failed'] : ['Assertion failed:', ...data];",
    "      sendOutput('assert', assertion);",
    '    },',
    "    clear: () => sendOutput('clear', []),",
    "    count: (label = 'default') => {",
    '      const key = String(label);',
    '      const value = (counts.get(key) ?? 0) + 1;',
    '      counts.set(key, value);',
    "      sendOutput('count', [`${key}: ${value}`]);",
    '    },',
    "    time: (label = 'default') => {",
    '      const key = String(label);',
    '      if (timers.has(key)) return;',
    '      timers.set(key, performance.now());',
    '    },',
    "    timeEnd: (label = 'default') => {",
    '      const key = String(label);',
    '      const start = timers.get(key);',
    '      if (start === undefined) return;',
    '      timers.delete(key);',
    "      sendOutput('timeEnd', [`${key}: ${performance.now() - start}ms`]);",
    '    },',
    '  });',
    "  Object.defineProperty(globalThis, 'console', {",
    '    configurable: true,',
    '    writable: true,',
    '    value: runConsole,',
    '  });',
    "  const entry = mode === 'warmup'",
    "    ? '/warmup.ts'",
    '    : `/execution.ts?session=${sessionToken}&run=${runToken}`;',
    '  void import(/* @vite-ignore */ entry).then(',
    "    () => send(mode === 'warmup' ? 'ready' : 'complete'),",
    '    (error) => {',
    "      send(mode === 'warmup' ? 'prepareError' : 'error', normalize(error));",
    "      if (mode === 'run') send('complete');",
    '    }',
    '  );',
    '})();',
    '',
  ].join('\n');

export const frameHtmlSource = (): string =>
  `<!doctype html><script type="module">${frameBootstrapSource()}</script>`;

export const runtimeSource = (): string =>
  [
    `const messageType = ${JSON.stringify(RUNTIME_MESSAGE_TYPE)};`,
    `const relayMarker = ${JSON.stringify(RUNTIME_RELAY_MARKER)};`,
    `const consoleMethods = new Set<string>(${JSON.stringify([
      ...CONSOLE_METHODS,
    ])});`,
    'type ConsoleValue = string | number | boolean | null | undefined;',
    "type FrameMode = 'warmup' | 'run';",
    'type ActiveFrame = {',
    '  frame: HTMLIFrameElement;',
    '  mode: FrameMode;',
    '  sessionToken: number;',
    '  runToken: number | undefined;',
    '  lastEventId: number;',
    '  listener: (event: MessageEvent) => void;',
    '};',
    'const parentConsole = globalThis.console;',
    'const isRecord = (value: unknown): value is Record<string, unknown> =>',
    "  typeof value === 'object' && value !== null && !Array.isArray(value);",
    'const isToken = (value: unknown): value is number =>',
    '  Number.isSafeInteger(value) && (value as number) >= 0;',
    'const utf8Bytes = (value: string): number => {',
    '  let bytes = 0;',
    '  for (let index = 0; index < value.length; index += 1) {',
    '    const codePoint = value.codePointAt(index);',
    '    if (codePoint === undefined) break;',
    '    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;',
    '    if (codePoint > 0xffff) index += 1;',
    '  }',
    '  return bytes;',
    '};',
    'const isConsoleValue = (value: unknown): value is ConsoleValue =>',
    '  value === null',
    '  || value === undefined',
    "  || typeof value === 'number'",
    "  || typeof value === 'boolean'",
    "  || (typeof value === 'string' && utf8Bytes(value) <= 4096);",
    'const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {',
    '  try {',
    '    const keys = Object.keys(value);',
    '    return keys.length === expected.length',
    '      && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));',
    '  } catch {',
    '    return false;',
    '  }',
    '};',
    'const boundedData = (value: unknown): value is ConsoleValue[] =>',
    '  Array.isArray(value) && value.length <= 20 && value.every(isConsoleValue);',
    'let activeFrame: ActiveFrame | undefined;',
    'let preparedSession: number | undefined;',
    'const relay = (record: unknown): void => {',
    '  parentConsole.debug(relayMarker, record);',
    '};',
    'const removeActiveFrame = (): void => {',
    '  const active = activeFrame;',
    '  if (!active) return;',
    '  activeFrame = undefined;',
    "  globalThis.removeEventListener('message', active.listener);",
    '  active.frame.remove();',
    '};',
    'const handleChildMessage = (active: ActiveFrame, event: MessageEvent): void => {',
    '  if (activeFrame !== active || event.source !== active.frame.contentWindow) return;',
    '  const message = event.data;',
    '  if (!isRecord(message) || message.type !== messageType || !isToken(message.sessionToken)) return;',
    '  if (message.sessionToken !== active.sessionToken) return;',
    "  if (active.mode === 'warmup') {",
    "    if (message.kind === 'ready' && hasExactKeys(message, ['type', 'kind', 'sessionToken'])) {",
    '      removeActiveFrame();',
    '      preparedSession = active.sessionToken;',
    "      relay({ kind: 'ready', sessionToken: active.sessionToken });",
    '      return;',
    '    }',
    "    if (message.kind === 'prepareError'",
    "      && hasExactKeys(message, ['type', 'kind', 'sessionToken', 'error'])",
    '      && isConsoleValue(message.error)) {',
    '      removeActiveFrame();',
    "      relay({ kind: 'prepareError', sessionToken: active.sessionToken, error: message.error });",
    '    }',
    '    return;',
    '  }',
    '  if (!isToken(message.runToken) || message.runToken !== active.runToken) return;',
    "  if (message.kind === 'output') {",
    "    if (!hasExactKeys(message, ['type', 'kind', 'sessionToken', 'runToken', 'eventId', 'method', 'data'])",
    '      || !isToken(message.eventId)',
    '      || message.eventId <= active.lastEventId',
    "      || typeof message.method !== 'string'",
    '      || !consoleMethods.has(message.method)',
    '      || !boundedData(message.data)) return;',
    '    active.lastEventId = message.eventId;',
    "    relay({ kind: 'output', sessionToken: active.sessionToken, runToken: active.runToken, eventId: message.eventId, method: message.method, data: message.data });",
    '    return;',
    '  }',
    "  if (message.kind === 'error') {",
    "    if (!hasExactKeys(message, ['type', 'kind', 'sessionToken', 'runToken', 'eventId', 'error'])",
    '      || !isToken(message.eventId)',
    '      || message.eventId <= active.lastEventId',
    '      || !isConsoleValue(message.error)) return;',
    '    active.lastEventId = message.eventId;',
    "    relay({ kind: 'error', sessionToken: active.sessionToken, runToken: active.runToken, eventId: message.eventId, error: message.error });",
    '    return;',
    '  }',
    "  if (message.kind === 'complete'",
    "    && hasExactKeys(message, ['type', 'kind', 'sessionToken', 'runToken'])) {",
    '    removeActiveFrame();',
    "    relay({ kind: 'complete', sessionToken: active.sessionToken, runToken: active.runToken });",
    '  }',
    '};',
    'const createFrame = (mode: FrameMode, sessionToken: number, runToken?: number): void => {',
    '  removeActiveFrame();',
    "  const frame = document.createElement('iframe');",
    '  frame.hidden = true;',
    "  frame.setAttribute('aria-hidden', 'true');",
    "  frame.setAttribute('sandbox', 'allow-scripts');",
    "  frame.setAttribute(mode === 'warmup' ? 'data-favy-playground-warmup' : 'data-favy-playground-execution', String(mode === 'warmup' ? sessionToken : runToken));",
    "  frame.src = mode === 'warmup'",
    '    ? `/frame.html?mode=warmup&session=${sessionToken}`',
    '    : `/frame.html?mode=run&session=${sessionToken}&run=${runToken}`;',
    '  document.body.append(frame);',
    '  const active = {',
    '    frame,',
    '    mode,',
    '    sessionToken,',
    '    runToken,',
    '    lastEventId: -1,',
    '    listener: (_event: MessageEvent): void => undefined,',
    '  } satisfies ActiveFrame;',
    '  active.listener = (event: MessageEvent): void => handleChildMessage(active, event);',
    '  activeFrame = active;',
    "  globalThis.addEventListener('message', active.listener);",
    '};',
    'const handleCommand = (event: MessageEvent): void => {',
    '  if (event.source !== parent) return;',
    '  const command = event.data;',
    '  if (!isRecord(command) || command.type !== messageType || !isToken(command.sessionToken)) return;',
    "  if (command.action === 'prepare') {",
    "    if (!hasExactKeys(command, ['type', 'action', 'sessionToken'])) return;",
    '    preparedSession = undefined;',
    "    createFrame('warmup', command.sessionToken);",
    '    return;',
    '  }',
    "  if (command.action !== 'run' && command.action !== 'cancel') return;",
    "  if (!hasExactKeys(command, ['type', 'action', 'sessionToken', 'runToken']) || !isToken(command.runToken)) return;",
    "  if (command.action === 'run') {",
    '    if (preparedSession !== command.sessionToken) return;',
    "    createFrame('run', command.sessionToken, command.runToken);",
    '    return;',
    '  }',
    '  const active = activeFrame;',
    "  if (!active || active.mode !== 'run'",
    '    || active.sessionToken !== command.sessionToken',
    '    || active.runToken !== command.runToken) return;',
    '  removeActiveFrame();',
    "  relay({ kind: 'cancelled', sessionToken: command.sessionToken, runToken: command.runToken });",
    '};',
    "globalThis.addEventListener('message', handleCommand);",
    '',
  ].join('\n');

const executionSource = (
  code: string,
  sessionToken: number,
  runToken: number
): string => `${code}\n// session:${sessionToken}\n// run:${runToken}\n`;

export const setupForRun = (
  setup: SandboxSetup,
  code: string,
  sessionToken: number,
  runToken: number
): SandboxSetup => {
  const executionFile: SandpackBundlerFile = {
    ...setup.files['/execution.ts'],
    code: executionSource(code, sessionToken, runToken),
  };

  return {
    ...setup,
    files: {
      ...setup.files,
      '/execution.ts': executionFile,
    },
  };
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
