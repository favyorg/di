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

type SandboxHandle = {
  readCode(): string;
  captureEditor(): EditorSnapshot | undefined;
};

type Drafts = Record<PlaygroundExampleId, string>;
type DependencyMap = Record<PlaygroundExampleId, PlaygroundDependencies>;
type ResetGenerations = Record<PlaygroundExampleId, number>;
type PlaygroundTheme = 'light' | 'dark';

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
    const liveCode = useRef(code);
    const previousCode = useRef(code);
    const handledRun = useRef(0);
    liveCode.current = code;

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

    const runSandpack = sandpack.runSandpack;
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
        onStatus('Running');
        stop = listen((message) => {
          if (message.type === 'done') {
            finish(message.compilatonError ? 'Failed' : 'Ready');
          }
          if (message.type === 'action' && message.action === 'show-error') {
            onStatus('Failed');
          }
        });
        failureTimer = window.setTimeout(() => finish('Failed'), 30_000);
        void runSandpack().catch(() => finish('Failed'));
      }, 0);
      return () => {
        settled = true;
        window.clearTimeout(launchTimer);
        if (failureTimer !== undefined) window.clearTimeout(failureTimer);
        stop?.();
      };
    }, [listen, onRunSettled, onStatus, runRequest, runSandpack, sandboxKey]);

    return (
      <>
        <SandpackCodeEditor
          ref={editorRef}
          initMode="immediate"
          showLineNumbers
          showRunButton={false}
          showTabs={false}
        />
        <SandpackConsole standalone />
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
    const [files] = useState(() => ({ '/index.ts': initialCode }));
    const customSetup = useMemo(
      () => ({ entry: '/index.ts', dependencies }),
      [dependencies]
    );

    return (
      <SandpackProvider
        template="vanilla-ts"
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
  const restoreSnapshot = useRef<EditorSnapshot>();
  const runCounter = useRef(0);
  const runRequestRef = useRef(runRequest);
  runRequestRef.current = runRequest;

  const sandboxKey = keyFor(
    selectedId,
    resetGeneration[selectedId],
    dependencies[selectedId]
  );
  const runDisabled =
    status === 'Preparing dependencies' || status === 'Running';

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

  const handleRunSettled = useCallback((token: number) => {
    setRunRequest((current) => (current?.token === token ? null : current));
  }, []);

  const handleCodeChange = useCallback(
    (code: string) => {
      setDrafts((current) => ({ ...current, [selectedId]: code }));
      setStatus('Checking imports');
      cancelScan();
      scanTimer.current = window.setTimeout(() => {
        scanTimer.current = undefined;
        const resolution = resolvePlaygroundDependencies(code);
        if (!resolution.ok) return;
        if (
          dependencySignature(resolution.dependencies) ===
          dependencySignature(dependencies[selectedId])
        ) {
          setStatus('Ready');
          return;
        }
        restoreSnapshot.current = sandboxRef.current?.captureEditor();
        setDependencies((current) => ({
          ...current,
          [selectedId]: resolution.dependencies,
        }));
        setStatus('Preparing dependencies');
      }, 1_000);
    },
    [cancelScan, dependencies, selectedId]
  );

  const selectExample = useCallback(
    (nextId: PlaygroundExampleId) => {
      if (nextId === selectedId) return;
      cancelScan();
      restoreSnapshot.current = undefined;
      setRunRequest(null);
      setSelectedId(nextId);
      setStatus('Ready');
    },
    [cancelScan, selectedId]
  );

  const resetExample = useCallback(() => {
    cancelScan();
    restoreSnapshot.current = undefined;
    setRunRequest(null);
    setDrafts((current) => ({
      ...current,
      [selectedId]: playgroundExampleById[selectedId].source,
    }));
    setDependencies((current) => ({
      ...current,
      [selectedId]: detectedDependencies[selectedId],
    }));
    setResetGeneration((current) => ({
      ...current,
      [selectedId]: current[selectedId] + 1,
    }));
    setStatus('Ready');
  }, [cancelScan, detectedDependencies, selectedId]);

  const run = useCallback(() => {
    if (runDisabled) return;
    cancelScan();
    const code = sandboxRef.current?.readCode() ?? drafts[selectedId];
    setDrafts((current) => ({ ...current, [selectedId]: code }));
    const resolution = resolvePlaygroundDependencies(code);
    const currentDependencies = dependencies[selectedId];
    const nextDependencies = resolution.ok
      ? resolution.dependencies
      : currentDependencies;
    const changed =
      dependencySignature(nextDependencies) !==
      dependencySignature(currentDependencies);
    if (changed) {
      restoreSnapshot.current = sandboxRef.current?.captureEditor();
      setDependencies((current) => ({
        ...current,
        [selectedId]: nextDependencies,
      }));
    }
    const targetKey = changed
      ? keyFor(selectedId, resetGeneration[selectedId], nextDependencies)
      : sandboxKey;
    runCounter.current += 1;
    setRunRequest({ token: runCounter.current, sandboxKey: targetKey });
    setStatus(changed ? 'Preparing dependencies' : 'Running');
  }, [
    cancelScan,
    dependencies,
    drafts,
    resetGeneration,
    runDisabled,
    sandboxKey,
    selectedId,
  ]);

  const handleExampleChange = (event: ChangeEvent<HTMLSelectElement>): void =>
    selectExample(event.currentTarget.value as PlaygroundExampleId);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    if (!runDisabled) run();
  };

  return (
    <div aria-label="TypeScript playground" onKeyDown={handleKeyDown}>
      <div>
        {playgroundExamples.map((example) => (
          <button
            key={example.id}
            type="button"
            aria-pressed={selectedId === example.id}
            onClick={() => selectExample(example.id)}
          >
            {example.title}
          </button>
        ))}
      </div>
      <label>
        Example
        <select
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
      </label>
      <button type="button" aria-label="Reset example" onClick={resetExample}>
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
      <span role="status" aria-live="polite">
        {status}
      </span>
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
  );
}
