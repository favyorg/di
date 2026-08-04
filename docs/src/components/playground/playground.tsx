import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  SandpackCodeEditor,
  SandpackConsole,
  SandpackProvider,
  useActiveCode,
  useSandpack,
  type CodeEditorRef,
} from '@codesandbox/sandpack-react';
import {
  dependencySignature,
  resolvePlaygroundDependencies,
  type PlaygroundDependencies,
} from './playground-dependencies';
import {
  playgroundExampleById,
  playgroundExamples,
  type PlaygroundExampleId,
} from './playground-examples';
import './playground.css';

type PlaygroundStatus =
  | 'Ready'
  | 'Checking imports'
  | 'Preparing dependencies'
  | 'Running'
  | 'Failed';

type EditorSnapshot = Readonly<{
  hadFocus: boolean;
  anchor: number;
  head: number;
}>;

type RunRequest = Readonly<{
  token: number;
  sandboxKey: string;
}>;

type DeferredScan = Readonly<{
  token: number;
  selectedId: PlaygroundExampleId;
  code: string;
}>;

type SandboxHandle = {
  readCode(): string;
  captureEditor(): EditorSnapshot | undefined;
};

type Drafts = Record<PlaygroundExampleId, string>;
type DependencyMap = Record<PlaygroundExampleId, PlaygroundDependencies>;
type ResetGenerations = Record<PlaygroundExampleId, number>;
type PlaygroundTheme = 'light' | 'dark';
type ConsoleLog = Readonly<{
  method: string;
  data?: readonly unknown[];
}>;

const SANDBOX_OPTIONS = Object.freeze({
  activeFile: '/index.ts',
  autorun: false,
  autoReload: false,
});

const initialDrafts = (): Drafts =>
  Object.fromEntries(
    playgroundExamples.map(({ id, source }) => [id, source])
  ) as Drafts;

const dependenciesFor = (source: string): PlaygroundDependencies => {
  const resolution = resolvePlaygroundDependencies(source);
  if (!resolution.ok) {
    throw new Error('A bundled playground example has invalid imports.');
  }
  return resolution.dependencies;
};

const initialDependencies = (): DependencyMap =>
  Object.fromEntries(
    playgroundExamples.map(({ id, source }) => [id, dependenciesFor(source)])
  ) as DependencyMap;

const initialResetGenerations = (): ResetGenerations =>
  Object.fromEntries(
    playgroundExamples.map(({ id }) => [id, 0])
  ) as ResetGenerations;

const formatConsoleValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall back to the value's string representation below.
  }
  try {
    return String(value);
  } catch {
    return '[Unserializable value]';
  }
};

const keyFor = (
  selectedId: PlaygroundExampleId,
  resetGeneration: number,
  dependencies: PlaygroundDependencies
): string =>
  [selectedId, resetGeneration, dependencySignature(dependencies)].join(':');

type SandboxContentsProps = Readonly<{
  sandboxKey: string;
  runRequest: RunRequest | null;
  restoreSnapshot: EditorSnapshot | undefined;
  onCodeChange(code: string): void;
  onReady(sandboxKey: string): void;
  onRunSettled(token: number): void;
  onStatus(status: PlaygroundStatus): void;
}>;

const SandboxContents = forwardRef<SandboxHandle, SandboxContentsProps>(
  function SandboxContents(
    {
      sandboxKey,
      runRequest,
      restoreSnapshot,
      onCodeChange,
      onReady,
      onRunSettled,
      onStatus,
    },
    forwardedRef
  ) {
    const { code } = useActiveCode();
    const { sandpack, listen } = useSandpack();
    const editorRef = useRef<CodeEditorRef>(null);
    const [consoleLines, setConsoleLines] = useState<readonly string[]>([]);
    const liveCode = useRef(code);
    const previousCode = useRef(code);
    const handledRun = useRef(0);
    const listenRef = useRef(listen);
    const runSandpackRef = useRef(sandpack.runSandpack);
    liveCode.current = code;
    listenRef.current = listen;
    runSandpackRef.current = sandpack.runSandpack;

    const handleConsoleLogs = useCallback((logs: readonly ConsoleLog[]) => {
      setConsoleLines(
        logs.flatMap(({ data, method }) => {
          if (method === 'clear') return [];
          const line = data?.map(formatConsoleValue).join(' ');
          return !line || (method === 'debug' && line.startsWith('[vite]'))
            ? []
            : [line];
        })
      );
    }, []);

    useImperativeHandle(
      forwardedRef,
      () => ({
        readCode: () => liveCode.current,
        captureEditor: () => {
          const view = editorRef.current?.getCodemirror();
          if (!view) return undefined;
          const { anchor, head } = view.state.selection.main;
          return { hadFocus: view.hasFocus, anchor, head };
        },
      }),
      []
    );

    useEffect(() => {
      if (code === previousCode.current) return;
      previousCode.current = code;
      onCodeChange(code);
    }, [code, onCodeChange]);

    useEffect(() => {
      const view = editorRef.current?.getCodemirror();
      if (view) {
        const editorLabel = 'TypeScript playground editor';
        view.dom.parentElement?.setAttribute('aria-label', editorLabel);
        view.contentDOM.setAttribute('aria-label', editorLabel);
      }
      onReady(sandboxKey);
      if (!restoreSnapshot) return;
      const timer = window.setTimeout(() => {
        const view = editorRef.current?.getCodemirror();
        if (!view) return;
        view.dispatch({
          selection: {
            anchor: restoreSnapshot.anchor,
            head: restoreSnapshot.head,
          },
        });
        if (restoreSnapshot.hadFocus) view.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }, [onReady, restoreSnapshot, sandboxKey]);

    useEffect(() => {
      if (!runRequest || runRequest.sandboxKey !== sandboxKey) return;
      let stop: (() => void) | undefined;
      let failureTimer: number | undefined;
      let settled = false;
      const finish = (nextStatus: PlaygroundStatus): void => {
        if (settled) return;
        settled = true;
        if (failureTimer !== undefined) window.clearTimeout(failureTimer);
        stop?.();
        stop = undefined;
        onStatus(nextStatus);
        onRunSettled(runRequest.token);
      };
      const launchTimer = window.setTimeout(() => {
        if (runRequest.token <= handledRun.current) return;
        handledRun.current = runRequest.token;
        setConsoleLines([]);
        onStatus('Running');
        stop = listenRef.current((message) => {
          if (message.type === 'done') {
            finish(message.compilatonError ? 'Failed' : 'Ready');
          }
          if (message.type === 'action' && message.action === 'show-error') {
            onStatus('Failed');
          }
        });
        failureTimer = window.setTimeout(() => finish('Failed'), 30_000);
        void runSandpackRef.current().catch(() => finish('Failed'));
      }, 0);
      return () => {
        settled = true;
        window.clearTimeout(launchTimer);
        if (failureTimer !== undefined) window.clearTimeout(failureTimer);
        stop?.();
      };
    }, [onRunSettled, onStatus, runRequest, sandboxKey]);

    return (
      <>
        <section
          className="playground__region playground__editor-region"
          aria-labelledby="playground-code-heading"
        >
          <h2 id="playground-code-heading">Code</h2>
          <div className="playground__editor">
            <SandpackCodeEditor
              ref={editorRef}
              initMode="immediate"
              showLineNumbers
              showRunButton={false}
              showTabs={false}
            />
          </div>
        </section>
        <section
          className="playground__region playground__console-region"
          aria-label="Console output"
        >
          <h2 id="playground-console-heading">Console</h2>
          <div className="playground__console">
            <div className="playground__console-output" role="log">
              {consoleLines.length === 0 ? (
                <span className="playground__console-empty">
                  Run code to see output.
                </span>
              ) : (
                consoleLines.map((line, index) => (
                  <div key={`${index}:${line}`}>{line}</div>
                ))
              )}
            </div>
            <div className="playground__runtime-client" aria-hidden="true">
              <SandpackConsole
                onLogsChange={handleConsoleLogs}
                resetOnPreviewRestart
                standalone
              />
            </div>
          </div>
        </section>
      </>
    );
  }
);

type SandboxSessionProps = SandboxContentsProps &
  Readonly<{
    dependencies: PlaygroundDependencies;
    initialCode: string;
    theme: PlaygroundTheme;
  }>;

const SandboxSession = forwardRef<SandboxHandle, SandboxSessionProps>(
  function SandboxSession(
    { dependencies, initialCode, theme, ...contentsProps },
    forwardedRef
  ) {
    const [files] = useState(() => ({
      '/index.ts': initialCode,
      '/index.html':
        '<!doctype html><script type="module" src="/index.ts"></script>',
    }));
    const customSetup = useMemo(
      () => ({ entry: '/index.ts', dependencies }),
      [dependencies]
    );

    return (
      <SandpackProvider
        template="vite"
        files={files}
        customSetup={customSetup}
        options={SANDBOX_OPTIONS}
        theme={theme}
      >
        <SandboxContents ref={forwardedRef} {...contentsProps} />
      </SandpackProvider>
    );
  }
);

const documentTheme = (): PlaygroundTheme =>
  typeof document !== 'undefined' &&
  document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light';

export function Playground(): JSX.Element {
  const [selectedId, setSelectedId] = useState<PlaygroundExampleId>('basic');
  const [drafts, setDrafts] = useState<Drafts>(initialDrafts);
  const [detectedDependencies] = useState<DependencyMap>(initialDependencies);
  const [dependencies, setDependencies] =
    useState<DependencyMap>(detectedDependencies);
  const [resetGeneration, setResetGeneration] = useState<ResetGenerations>(
    initialResetGenerations
  );
  const [status, setStatus] = useState<PlaygroundStatus>('Ready');
  const [runRequest, setRunRequest] = useState<RunRequest | null>(null);
  const [theme, setTheme] = useState<PlaygroundTheme>(documentTheme);
  const sandboxRef = useRef<SandboxHandle>(null);
  const scanTimer = useRef<number>();
  const deferredScan = useRef<DeferredScan>();
  const restoreSnapshot = useRef<EditorSnapshot>();
  const runCounter = useRef(0);
  const runRequestRef = useRef(runRequest);
  const selectedIdRef = useRef(selectedId);
  const dependenciesRef = useRef(dependencies);
  runRequestRef.current = runRequest;
  selectedIdRef.current = selectedId;
  dependenciesRef.current = dependencies;

  const sandboxKey = keyFor(
    selectedId,
    resetGeneration[selectedId],
    dependencies[selectedId]
  );
  const runDisabled =
    runRequest !== null ||
    status === 'Preparing dependencies' ||
    status === 'Running';

  const cancelScan = useCallback(() => {
    if (scanTimer.current === undefined) return;
    window.clearTimeout(scanTimer.current);
    scanTimer.current = undefined;
  }, []);

  useEffect(() => cancelScan, [cancelScan]);

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = (): void => setTheme(documentTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    updateTheme();
    return () => observer.disconnect();
  }, []);

  const handleSandboxReady = useCallback((readyKey: string) => {
    if (runRequestRef.current?.sandboxKey !== readyKey) setStatus('Ready');
  }, []);

  const updateDependencies = useCallback(
    (
      updateSelectedId: PlaygroundExampleId,
      nextDependencies: PlaygroundDependencies
    ) => {
      const next = {
        ...dependenciesRef.current,
        [updateSelectedId]: nextDependencies,
      };
      dependenciesRef.current = next;
      setDependencies(next);
    },
    []
  );

  const applyDependencyScan = useCallback(
    (scanSelectedId: PlaygroundExampleId, code: string) => {
      if (selectedIdRef.current !== scanSelectedId) return;
      const resolution = resolvePlaygroundDependencies(code);
      if (!resolution.ok) {
        setStatus('Checking imports');
        return;
      }
      if (
        dependencySignature(resolution.dependencies) ===
        dependencySignature(dependenciesRef.current[scanSelectedId])
      ) {
        setStatus('Ready');
        return;
      }
      restoreSnapshot.current = sandboxRef.current?.captureEditor();
      updateDependencies(scanSelectedId, resolution.dependencies);
      setStatus('Preparing dependencies');
    },
    [updateDependencies]
  );

  const handleRunSettled = useCallback(
    (token: number) => {
      if (runRequestRef.current?.token !== token) return;
      runRequestRef.current = null;
      setRunRequest(null);
      const scan = deferredScan.current;
      if (scan?.token === token) {
        deferredScan.current = undefined;
        applyDependencyScan(scan.selectedId, scan.code);
        return;
      }
      if (scanTimer.current !== undefined) setStatus('Checking imports');
    },
    [applyDependencyScan]
  );

  const handleCodeChange = useCallback(
    (code: string) => {
      const editSelectedId = selectedIdRef.current;
      setDrafts((current) => ({ ...current, [editSelectedId]: code }));
      setStatus('Checking imports');
      cancelScan();
      deferredScan.current = undefined;
      scanTimer.current = window.setTimeout(() => {
        scanTimer.current = undefined;
        const activeRequest = runRequestRef.current;
        if (activeRequest) {
          deferredScan.current = {
            token: activeRequest.token,
            selectedId: editSelectedId,
            code,
          };
          return;
        }
        applyDependencyScan(editSelectedId, code);
      }, 1_000);
    },
    [applyDependencyScan, cancelScan]
  );

  const selectExample = useCallback(
    (nextId: PlaygroundExampleId) => {
      if (nextId === selectedId) return;
      cancelScan();
      deferredScan.current = undefined;
      restoreSnapshot.current = undefined;
      runRequestRef.current = null;
      setRunRequest(null);
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      setStatus('Ready');
    },
    [cancelScan, selectedId]
  );

  const resetExample = useCallback(() => {
    cancelScan();
    deferredScan.current = undefined;
    restoreSnapshot.current = undefined;
    runRequestRef.current = null;
    setRunRequest(null);
    setDrafts((current) => ({
      ...current,
      [selectedId]: playgroundExampleById[selectedId].source,
    }));
    updateDependencies(selectedId, detectedDependencies[selectedId]);
    setResetGeneration((current) => ({
      ...current,
      [selectedId]: current[selectedId] + 1,
    }));
    setStatus('Ready');
  }, [cancelScan, detectedDependencies, selectedId, updateDependencies]);

  const run = useCallback(() => {
    if (runRequestRef.current || runDisabled) return;
    cancelScan();
    deferredScan.current = undefined;
    const code = sandboxRef.current?.readCode() ?? drafts[selectedId];
    setDrafts((current) => ({ ...current, [selectedId]: code }));
    const resolution = resolvePlaygroundDependencies(code);
    if (!resolution.ok) {
      setStatus('Checking imports');
      return;
    }
    const currentDependencies = dependenciesRef.current[selectedId];
    const nextDependencies = resolution.dependencies;
    const changed =
      dependencySignature(nextDependencies) !==
      dependencySignature(currentDependencies);
    if (changed) {
      restoreSnapshot.current = sandboxRef.current?.captureEditor();
      updateDependencies(selectedId, nextDependencies);
    }
    const targetKey = changed
      ? keyFor(selectedId, resetGeneration[selectedId], nextDependencies)
      : sandboxKey;
    runCounter.current += 1;
    const request = { token: runCounter.current, sandboxKey: targetKey };
    runRequestRef.current = request;
    setRunRequest(request);
    setStatus(changed ? 'Preparing dependencies' : 'Running');
  }, [
    cancelScan,
    drafts,
    resetGeneration,
    runDisabled,
    sandboxKey,
    selectedId,
    updateDependencies,
  ]);

  const handleExampleChange = (event: ChangeEvent<HTMLSelectElement>): void =>
    selectExample(event.currentTarget.value as PlaygroundExampleId);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    if (!runDisabled) run();
  };

  return (
    <section
      className="playground not-content"
      aria-label="TypeScript playground"
      onKeyDown={handleKeyDown}
    >
      <nav className="playground__desktop-nav" aria-label="Playground examples">
        <h2>Examples</h2>
        <div className="playground__example-list">
          {playgroundExamples.map((example) => {
            const selected = selectedId === example.id;
            const descriptionId = `playground-example-${example.id}-description`;
            return (
              <button
                key={example.id}
                className="playground__example"
                type="button"
                aria-label={example.title}
                aria-describedby={descriptionId}
                aria-pressed={selected}
                onClick={() => selectExample(example.id)}
              >
                <span className="playground__example-heading">
                  <span>{example.title}</span>
                  {selected && (
                    <span
                      className="playground__selected-marker"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  )}
                </span>
                <span
                  id={descriptionId}
                  className="playground__example-description"
                >
                  {example.description}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="playground__mobile-nav">
        <label htmlFor="playground-example-select">Example</label>
        <select
          id="playground-example-select"
          aria-label="Example"
          value={selectedId}
          onChange={handleExampleChange}
        >
          {playgroundExamples.map((example) => (
            <option key={example.id} value={example.id}>
              {example.title}
            </option>
          ))}
        </select>
      </div>
      <div className="playground__workspace">
        <div
          className="playground__toolbar"
          role="toolbar"
          aria-label="Playground controls"
          aria-busy={runDisabled}
        >
          <button
            type="button"
            aria-label="Reset example"
            onClick={resetExample}
          >
            Reset
          </button>
          <button
            type="button"
            aria-label="Run code"
            disabled={runDisabled}
            onClick={run}
          >
            Run
          </button>
          <span className="playground__shortcut">
            Shortcut: <kbd>Ctrl/⌘ + Enter</kbd>
          </span>
          <span className="playground__status" role="status" aria-live="polite">
            {status}
          </span>
        </div>
        <div className="playground__sandbox">
          <SandboxSession
            key={sandboxKey}
            ref={sandboxRef}
            sandboxKey={sandboxKey}
            dependencies={dependencies[selectedId]}
            initialCode={drafts[selectedId]}
            theme={theme}
            runRequest={runRequest}
            restoreSnapshot={restoreSnapshot.current}
            onCodeChange={handleCodeChange}
            onReady={handleSandboxReady}
            onRunSettled={handleRunSettled}
            onStatus={setStatus}
          />
        </div>
      </div>
    </section>
  );
}
