import { useEffect, useRef, useState } from 'react';
import { compileExample } from '../compile-example';
import type { ProjectEditorRuntime } from './project-editor';
import { ProjectPreview } from './project-preview';

export function useBrowserRunner({
  runtime,
  entry,
  theme,
}: {
  runtime?: ProjectEditorRuntime;
  entry: string;
  theme: 'light' | 'dark';
}) {
  const active = useRef<AbortController>();
  const [snapshot, setSnapshot] = useState<{
    files: Record<string, string>;
    id: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = undefined;
    },
    []
  );

  const stop = () => {
    active.current?.abort();
    active.current = undefined;
    setSnapshot(undefined);
    setBusy(false);
    setStatus('Stopped');
    setError('');
  };

  const start = async () => {
    if (!runtime || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const nextFiles = Object.fromEntries(
      [...runtime.models].map(([path, model]) => [path, model.getValue()])
    );
    setSnapshot(undefined);
    setBusy(true);
    setError('');
    setStatus('Compiling…');
    try {
      const models = new Map(
        [...runtime.models].filter(([path]) => /\.tsx?$/.test(path))
      );
      await compileExample(runtime.monaco, models, entry, controller.signal);
      if (active.current !== controller) return;
      setSnapshot({ files: nextFiles, id: ++generation.current });
      setStatus('Preview running');
    } catch (cause) {
      if (active.current !== controller) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('Failed');
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        setBusy(false);
      }
    }
  };

  return {
    start,
    stop,
    busy,
    status,
    running: Boolean(snapshot),
    output: snapshot ? (
      <ProjectPreview
        key={snapshot.id}
        files={snapshot.files}
        entry={entry}
        theme={theme}
      />
    ) : (
      <div className="project-preview-message" role="status">
        {error || status || 'Press Run to open the app preview.'}
      </div>
    ),
  };
}
