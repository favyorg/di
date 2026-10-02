import { useEffect, useId, useRef, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { compileExample } from './compile-example';
import { startExampleSandbox, type RunEvent } from './example-sandbox';

type Phase =
  | 'idle'
  | 'compiling'
  | 'running'
  | 'complete'
  | 'error'
  | 'stopped';
type OutputLine = { level: 'log' | 'info' | 'warn' | 'error'; text: string };
type ActiveRun = { controller: AbortController; stop?: () => void };

const labels: Record<Phase, string> = {
  idle: '',
  compiling: 'Compiling…',
  running: 'Running…',
  complete: 'Finished',
  error: 'Failed',
  stopped: 'Stopped',
};

export function useExampleRunner({
  entry,
  monaco,
  models,
}: {
  entry?: string;
  monaco?: Monaco;
  models: ReadonlyMap<string, editor.ITextModel>;
}) {
  const outputId = useId();
  const active = useRef<ActiveRun>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [lines, setLines] = useState<OutputLine[]>([]);
  const busy = phase === 'compiling' || phase === 'running';

  const cancel = () => {
    const run = active.current;
    active.current = undefined;
    run?.controller.abort();
    run?.stop?.();
  };

  useEffect(() => cancel, []);

  const stop = () => {
    cancel();
    setPhase('stopped');
  };

  const start = async () => {
    if (!entry || !monaco || active.current) return;
    const run: ActiveRun = { controller: new AbortController() };
    active.current = run;
    setLines([]);
    setPhase('compiling');

    const onEvent = (event: RunEvent) => {
      if (active.current !== run) return;
      if (event.type === 'output') {
        setLines((current) => [
          ...current,
          { level: event.level, text: event.text },
        ]);
      } else {
        active.current = undefined;
        setPhase(event.type === 'complete' ? 'complete' : 'error');
        if (event.type === 'error') {
          setLines((current) => [
            ...current,
            { level: 'error', text: event.text },
          ]);
        }
      }
    };

    try {
      const program = await compileExample(
        monaco,
        models,
        entry,
        run.controller.signal
      );
      if (active.current !== run) return;
      setPhase('running');
      run.stop = startExampleSandbox(program, onEvent);
    } catch (error) {
      onEvent({
        type: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    start,
    stop,
    busy,
    status: labels[phase],
    controls: entry ? (
      <div className="example-run-controls">
        <button
          type="button"
          className="example-run-button"
          aria-label={busy ? 'Stop example' : `Run ${entry}`}
          aria-controls={outputId}
          disabled={!monaco}
          onClick={() => {
            if (busy) {
              stop();
            } else {
              void start();
            }
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            {busy ? <path d="M5 5h10v10H5z" /> : <path d="m6 3 11 7-11 7Z" />}
          </svg>
          <span>{busy ? 'Stop' : 'Run'}</span>
        </button>
      </div>
    ) : null,
    output: entry ? (
      <section
        className="example-run-console"
        aria-label="Example output"
        id={outputId}
        hidden={phase === 'idle'}
      >
        <div className="example-run-console-header">
          <span>Console</span>
          <span role="status">{labels[phase]}</span>
        </div>
        <pre
          className="example-run-output"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {lines.length ? (
            lines.map((line, index) => (
              <span
                className="example-run-line"
                data-level={line.level}
                key={index}
              >
                {line.text}
                {'\n'}
              </span>
            ))
          ) : (
            <span className="example-run-empty">
              {phase === 'complete'
                ? 'Finished without console output.'
                : 'No output yet.'}
            </span>
          )}
        </pre>
      </section>
    ) : null,
  };
}
