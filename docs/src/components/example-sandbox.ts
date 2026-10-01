import { exampleWorker } from './example-worker';

export type RunEvent =
  | { type: 'output'; level: 'log' | 'info' | 'warn' | 'error'; text: string }
  | { type: 'complete' }
  | { type: 'error'; text: string };

type Program = { modules: Record<string, string>; entry: string };

// Only this fixed bootstrap runs in the iframe. Editable code stays in a worker.
function sandboxFrame() {
  let worker: Worker | undefined;
  let workerUrl: string | undefined;
  let token: string | undefined;
  function dispose() {
    worker?.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    worker = undefined;
    workerUrl = undefined;
  }
  window.addEventListener('pagehide', dispose);
  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    if (event.data?.type === 'stop' && event.data.token === token) {
      dispose();
      parent.postMessage({ token, disposed: true }, '*');
      return;
    }
    if (
      token ||
      event.data?.type !== 'start' ||
      typeof event.data.token !== 'string'
    )
      return;
    token = event.data.token;
    try {
      workerUrl = URL.createObjectURL(
        new Blob([event.data.source], { type: 'text/javascript' })
      );
      worker = new Worker(workerUrl);
      worker.onmessage = ({ data }) => {
        if (data?.type === 'complete' || data?.type === 'error') dispose();
        parent.postMessage({ token, event: data }, '*');
      };
      worker.onerror = (error) => {
        error.preventDefault();
        dispose();
        parent.postMessage(
          {
            token,
            event: {
              type: 'error',
              text: error.message || 'Execution worker failed.',
            },
          },
          '*'
        );
      };
      worker.postMessage(event.data.program);
    } catch (error) {
      dispose();
      parent.postMessage(
        {
          token,
          event: {
            type: 'error',
            text: error instanceof Error ? error.message : String(error),
          },
        },
        '*'
      );
    }
  });
}

/** Run compiled example modules without access to the documentation page or network. */
export function startExampleSandbox(
  program: Program,
  onEvent: (event: RunEvent) => void
): () => void {
  const frame = document.createElement('iframe');
  const token = crypto.randomUUID();
  let stopped = false;
  let started = false;
  let outputCount = 0;
  let outputSize = 0;
  let watchdog: ReturnType<typeof setTimeout>;
  let disposalWatchdog: ReturnType<typeof setTimeout> | undefined;

  function removeFrame() {
    if (disposalWatchdog !== undefined) clearTimeout(disposalWatchdog);
    window.removeEventListener('message', receive);
    frame.remove();
  }

  function cleanup(alreadyDisposed = false) {
    if (stopped) return;
    stopped = true;
    clearTimeout(watchdog);
    frame.removeEventListener('load', start);
    if (!started || alreadyDisposed) {
      removeFrame();
    } else {
      // Removing the frame before it handles Stop can orphan a looping worker.
      frame.contentWindow?.postMessage({ type: 'stop', token }, '*');
      disposalWatchdog = setTimeout(removeFrame, 1000);
    }
  }

  function finish(event: RunEvent, alreadyDisposed = false) {
    if (stopped) return;
    cleanup(alreadyDisposed);
    onEvent(event);
  }

  function receive(message: MessageEvent) {
    if (message.source !== frame.contentWindow || message.data?.token !== token)
      return;
    if (message.data.disposed === true) {
      removeFrame();
      return;
    }
    if (stopped) return;
    const event = message.data.event;
    if (!event || typeof event !== 'object') return;
    if (event.type === 'complete') {
      finish({ type: 'complete' }, true);
    } else if (event.type === 'error' && typeof event.text === 'string') {
      finish({ type: 'error', text: event.text.slice(0, 4000) }, true);
    } else if (
      event.type === 'output' &&
      ['log', 'info', 'warn', 'error'].includes(event.level) &&
      typeof event.text === 'string'
    ) {
      if (
        outputCount >= 100 ||
        outputSize >= 64000 ||
        event.text.length > 4000
      ) {
        finish({
          type: 'error',
          text: 'Output limit exceeded (100 messages or 64,000 characters).',
        });
        return;
      }
      const text = event.text.slice(0, 64000 - outputSize);
      outputCount += 1;
      outputSize += text.length;
      onEvent({ type: 'output', level: event.level, text });
    }
  }

  function start() {
    if (stopped) return;
    started = true;
    frame.contentWindow?.postMessage(
      {
        type: 'start',
        token,
        source: `(${exampleWorker.toString()})();`,
        program,
      },
      '*'
    );
  }

  frame.hidden = true;
  frame.title = 'Isolated example execution';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none';"><script>(${sandboxFrame.toString()})();<\/script>`;
  frame.addEventListener('load', start, { once: true });
  window.addEventListener('message', receive);
  // The watchdog stays outside the worker so even an infinite loop can be stopped.
  watchdog = setTimeout(
    () =>
      finish({ type: 'error', text: 'Execution timed out after 5 seconds.' }),
    5000
  );
  document.body.append(frame);
  return () => cleanup();
}
