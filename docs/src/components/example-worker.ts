// This function is serialized into an isolated worker; keep its dependencies local.
export function exampleWorker() {
  type Program = { modules: Record<string, string>; entry: string };
  type Level = 'log' | 'info' | 'warn' | 'error';
  const send = globalThis.postMessage.bind(globalThis);
  const nativeTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeInterval = globalThis.setInterval.bind(globalThis);
  const nativeClear = globalThis.clearTimeout.bind(globalThis);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let idle: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let initialized = false;
  let outputCount = 0;
  let outputSize = 0;

  function format(value: unknown, seen = new Set<object>(), depth = 0): string {
    if (typeof value === 'string') return value.slice(0, 4000);
    if (value instanceof Error)
      return `${value.name}: ${value.message}`.slice(0, 4000);
    if (value === null || typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    if (depth >= 4) return Array.isArray(value) ? '[…]' : '{…}';
    seen.add(value);
    try {
      const keys = Object.keys(value).slice(0, 20);
      const entries = keys.map((key) => {
        const child = (value as Record<string, unknown>)[key];
        const text =
          typeof child === 'string'
            ? JSON.stringify(child.slice(0, 1000))
            : format(child, seen, depth + 1);
        return Array.isArray(value) ? text : `${JSON.stringify(key)}: ${text}`;
      });
      const more = Array.isArray(value) && value.length > keys.length;
      if (more) entries.push('…');
      return (
        Array.isArray(value)
          ? `[${entries.join(', ')}]`
          : `{${entries.join(', ')}}`
      ).slice(0, 4000);
    } catch {
      return '[Unprintable value]';
    } finally {
      seen.delete(value);
    }
  }

  function finish(
    event: { type: 'complete' } | { type: 'error'; text: string }
  ) {
    if (finished) return;
    finished = true;
    if (idle !== undefined) nativeClear(idle);
    for (const timer of timers) nativeClear(timer);
    timers.clear();
    send(event);
  }

  function fail(error: unknown) {
    let text = 'Unknown execution error';
    try {
      text = format(error);
    } catch {
      /* Hostile values must not hide an error. */
    }
    finish({ type: 'error', text: text.slice(0, 4000) });
  }

  function scheduleCompletion() {
    if (finished || !initialized || timers.size > 0) return;
    if (idle !== undefined) nativeClear(idle);
    // Yield beyond the microtask queue and unhandled-rejection dispatch.
    idle = nativeTimeout(() => {
      idle = nativeTimeout(() => {
        if (timers.size === 0) finish({ type: 'complete' });
      }, 0);
    }, 0);
  }

  function output(level: Level, values: unknown[]) {
    if (finished) return;
    if (outputCount >= 100 || outputSize >= 64000) {
      finish({
        type: 'error',
        text: 'Output limit exceeded (100 messages or 64,000 characters).',
      });
      return;
    }
    const text = values
      .slice(0, 20)
      .map((value) => format(value))
      .join(' ')
      .slice(0, Math.min(4000, 64000 - outputSize));
    outputCount += 1;
    outputSize += text.length;
    send({ type: 'output', level, text });
  }

  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[level] = (...values: unknown[]) =>
      output(level === 'debug' ? 'log' : level, values);
  }

  function setTimer(
    repeat: boolean,
    callback: unknown,
    delay = 0,
    ...args: unknown[]
  ) {
    if (typeof callback !== 'function')
      throw new TypeError('Timer callbacks must be functions.');
    if (finished) return 0;
    if (idle !== undefined) nativeClear(idle);
    const create = repeat ? nativeInterval : nativeTimeout;
    const timer = create(() => {
      if (!repeat) timers.delete(timer);
      try {
        callback(...args);
      } catch (error) {
        fail(error);
      }
      scheduleCompletion();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function clearTimer(timer: ReturnType<typeof setTimeout>) {
    nativeClear(timer);
    timers.delete(timer);
    scheduleCompletion();
  }

  Object.assign(globalThis, {
    setTimeout: (callback: unknown, delay?: number, ...args: unknown[]) =>
      setTimer(false, callback, delay, ...args),
    setInterval: (callback: unknown, delay?: number, ...args: unknown[]) =>
      setTimer(true, callback, delay, ...args),
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
  });
  globalThis.addEventListener('error', (event) => {
    event.preventDefault();
    fail((event as ErrorEvent).error ?? (event as ErrorEvent).message);
  });
  globalThis.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    fail((event as PromiseRejectionEvent).reason);
  });

  globalThis.addEventListener('message', (event: MessageEvent<Program>) => {
    if (initialized || finished) return;
    initialized = true;
    const { modules, entry } = event.data;
    const cache = new Map<string, { exports: unknown }>();
    const contains = (path: string) =>
      Object.prototype.hasOwnProperty.call(modules, path);

    function resolve(request: string, from: string) {
      if (request === '@favy/di')
        return 'file:///node_modules/@favy/di/src/index.ts';
      if (!request.startsWith('./') && !request.startsWith('../')) {
        throw new Error(
          `Unsupported import: ${request}. Only example files and @favy/di are available.`
        );
      }
      const path = new URL(request, from).href;
      const candidates = [
        path,
        path.replace(/\.js$/, '.ts'),
        `${path}.ts`,
        `${path}/index.ts`,
      ];
      const match = candidates.find(contains);
      if (!match)
        throw new Error(`Cannot find module ${request} imported by ${from}.`);
      return match;
    }

    function requireModule(path: string): unknown {
      const previous = cache.get(path);
      if (previous) return previous.exports;
      if (!contains(path)) throw new Error(`Cannot find module ${path}.`);
      const module = { exports: {} as unknown };
      cache.set(path, module);
      try {
        const execute = new Function(
          'require',
          'module',
          'exports',
          `${modules[path]}\n//# sourceURL=${path.replace(/[\r\n]/g, '')}`
        );
        execute(
          (request: string) => requireModule(resolve(request, path)),
          module,
          module.exports
        );
      } catch (error) {
        cache.delete(path);
        throw error;
      }
      return module.exports;
    }

    try {
      requireModule(entry);
      scheduleCompletion();
    } catch (error) {
      fail(error);
    }
  });
}
