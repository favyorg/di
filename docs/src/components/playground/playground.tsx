import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  SandpackCodeEditor,
  SandpackProvider,
  useActiveCode,
  useSandpackClient,
} from '@codesandbox/sandpack-react';
import {
  TypeScriptEditor,
  type TypeScriptEditorHandle,
  type TypeScriptEditorSnapshot,
} from '../typescript-editor';
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
import {
  completionToken,
  preparationLabel,
  runErrorRecord,
  runOutputRecord,
  runtimeCommand,
  runtimeSource,
  setupForRun,
} from './playground-runtime';
import './playground.css';

type PlaygroundStatus =
  | 'Loading editor'
  | 'Ready'
  | 'Checking imports'
  | 'Preparing dependencies'
  | 'Preparing runtime'
  | 'Downloading packages'
  | 'Installing packages'
  | 'Starting Vite'
  | 'Running'
  | 'Failed';

type RunRequest = Readonly<{
  token: number;
  sandboxKey: string;
  code: string;
}>;

type PendingExecution = Readonly<{
  token: number;
  content: string;
}>;

type DeferredScan = Readonly<{
  token: number;
  selectedId: PlaygroundExampleId;
  code: string;
}>;

type SandboxHandle = {
  readCode(): string;
  captureEditor(): TypeScriptEditorSnapshot | undefined;
};

type Drafts = Record<PlaygroundExampleId, string>;
type DependencyMap = Record<PlaygroundExampleId, PlaygroundDependencies>;
type ResetGenerations = Record<PlaygroundExampleId, number>;
type PlaygroundTheme = 'light' | 'dark';
type ConsoleLog = Readonly<{
  id?: string;
  method: string;
  data?: readonly unknown[];
}>;

const SANDBOX_OPTIONS = Object.freeze({
  activeFile: '/index.ts',
  autorun: true,
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

const keyFor = (dependencies: PlaygroundDependencies): string =>
  dependencySignature(dependencies);

type SandboxContentsProps = Readonly<{
  activeCode: string;
  codeIdentity: string;
  sandboxKey: string;
  typingVersions: Readonly<Record<string, string>>;
  runRequest: RunRequest | null;
  restoreSnapshot: TypeScriptEditorSnapshot | undefined;
  onCodeChange(code: string): void;
  onReady(sandboxKey: string): void;
  onRunSettled(token: number): void;
  onStatus(status: PlaygroundStatus): void;
}>;

const SandboxContents = forwardRef<SandboxHandle, SandboxContentsProps>(
  function SandboxContents(
    {
      activeCode,
      codeIdentity,
      sandboxKey,
      typingVersions,
      runRequest,
      restoreSnapshot,
      onCodeChange,
      onReady,
      onRunSettled,
      onStatus,
    },
    forwardedRef
  ) {
    const { code, updateCode } = useActiveCode();
    const { iframe, getClient, listen } = useSandpackClient();
    const editorRef = useRef<TypeScriptEditorHandle>(null);
    const [consoleLines, setConsoleLines] = useState<readonly string[]>([]);
    const liveCode = useRef(code);
    const previousCode = useRef(code);
    const previousCodeIdentity = useRef(codeIdentity);
    const expectedProgrammaticCode = useRef<string>();
    const handledRun = useRef(0);
    const runtimeReady = useRef(false);
    const activeRun = useRef<RunRequest>();
    const runFailed = useRef(false);
    const pendingExecution = useRef<PendingExecution>();
    const suppressedRun = useRef<number>();
    const visibleRunToken = useRef<number>();
    const failureTimer = useRef<number>();
    const clientRetryTimer = useRef<number>();
    const clientRetryToken = useRef<number>();
    const suppressionTimer = useRef<number>();
    const seenConsoleIds = useRef(new Set<string>());
    const listenRef = useRef(listen);
    const getClientRef = useRef(getClient);
    const runRequestRef = useRef(runRequest);
    const sandboxKeyRef = useRef(sandboxKey);
    const onCodeChangeRef = useRef(onCodeChange);
    const onReadyRef = useRef(onReady);
    const onRunSettledRef = useRef(onRunSettled);
    const onStatusRef = useRef(onStatus);
    const handleMessageRef = useRef<Parameters<typeof listen>[0]>(() => {});
    const tryLaunchRef = useRef<() => void>(() => {});
    liveCode.current = code;
    listenRef.current = listen;
    getClientRef.current = getClient;
    runRequestRef.current = runRequest;
    sandboxKeyRef.current = sandboxKey;
    onCodeChangeRef.current = onCodeChange;
    onReadyRef.current = onReady;
    onRunSettledRef.current = onRunSettled;
    onStatusRef.current = onStatus;

    const clearConsole = useCallback(() => {
      seenConsoleIds.current.clear();
      setConsoleLines([]);
    }, []);

    const clearFailureTimer = useCallback(() => {
      if (failureTimer.current === undefined) return;
      window.clearTimeout(failureTimer.current);
      failureTimer.current = undefined;
    }, []);

    const clearClientRetry = useCallback(() => {
      if (clientRetryTimer.current !== undefined) {
        window.clearTimeout(clientRetryTimer.current);
        clientRetryTimer.current = undefined;
      }
      clientRetryToken.current = undefined;
    }, []);

    const clearSuppressionTimer = useCallback(() => {
      if (suppressionTimer.current === undefined) return;
      window.clearTimeout(suppressionTimer.current);
      suppressionTimer.current = undefined;
    }, []);

    const postRuntimeCommand = useCallback(
      (action: 'prepare' | 'run', token: number): boolean => {
        const runtime = iframe.current;
        if (!runtime?.contentWindow) return false;
        let targetOrigin = '*';
        try {
          if (runtime.src) targetOrigin = new URL(runtime.src).origin;
        } catch {
          // The runtime can briefly expose an opaque URL while it attaches.
        }
        runtime.contentWindow.postMessage(
          runtimeCommand(action, token),
          targetOrigin
        );
        return true;
      },
      [iframe]
    );

    const releaseSuppressedRun = useCallback(
      (token: number): boolean => {
        if (suppressedRun.current !== token) return false;
        clearSuppressionTimer();
        suppressedRun.current = undefined;
        tryLaunchRef.current();
        return true;
      },
      [clearSuppressionTimer]
    );

    const finish = useCallback(
      (request: RunRequest, nextStatus: PlaygroundStatus): void => {
        const isActive = activeRun.current?.token === request.token;
        const isQueued = runRequestRef.current?.token === request.token;
        if (!isActive && !isQueued) return;
        clearFailureTimer();
        clearClientRetry();
        if (pendingExecution.current?.token === request.token) {
          pendingExecution.current = undefined;
        }
        activeRun.current = undefined;
        runFailed.current = false;
        onStatusRef.current(nextStatus);
        onRunSettledRef.current(request.token);
      },
      [clearClientRetry, clearFailureTimer]
    );

    const tryLaunch = useCallback((): void => {
      const request = runRequestRef.current;
      if (
        !request ||
        request.sandboxKey !== sandboxKeyRef.current ||
        !runtimeReady.current ||
        request.token <= handledRun.current ||
        activeRun.current
      ) {
        return;
      }
      if (suppressedRun.current !== undefined) {
        onStatusRef.current('Preparing runtime');
        return;
      }

      const client = getClientRef.current();
      if (!client) {
        onStatusRef.current('Preparing runtime');
        if (clientRetryToken.current === request.token) {
          finish(request, 'Failed');
          return;
        }
        clientRetryToken.current = request.token;
        clientRetryTimer.current = window.setTimeout(() => {
          clientRetryTimer.current = undefined;
          tryLaunchRef.current();
        }, 0);
        return;
      }

      clearClientRetry();
      clearFailureTimer();
      failureTimer.current = window.setTimeout(
        () => finish(request, 'Failed'),
        30_000
      );
      handledRun.current = request.token;
      activeRun.current = request;
      runFailed.current = false;
      visibleRunToken.current = request.token;
      clearConsole();
      onStatusRef.current('Running');
      try {
        const nextSetup = setupForRun(
          client.sandboxSetup,
          request.code,
          request.token
        );
        const content = nextSetup.files['/execution.ts'].code;
        pendingExecution.current = { token: request.token, content };
        if (!postRuntimeCommand('prepare', request.token)) {
          finish(request, 'Failed');
          return;
        }
        client.updateSandbox(nextSetup);
      } catch {
        finish(request, 'Failed');
      }
    }, [
      clearClientRetry,
      clearConsole,
      clearFailureTimer,
      finish,
      postRuntimeCommand,
    ]);
    tryLaunchRef.current = tryLaunch;

    handleMessageRef.current = (message) => {
      if (message.type === 'fs/change') {
        const pending = pendingExecution.current;
        if (
          !pending ||
          message.path !== '/execution.ts' ||
          message.content !== pending.content ||
          activeRun.current?.token !== pending.token
        ) {
          return;
        }
        pendingExecution.current = undefined;
        if (!postRuntimeCommand('run', pending.token)) {
          finish(activeRun.current, 'Failed');
        }
        return;
      }

      const progress = preparationLabel(message);
      if (
        progress &&
        !activeRun.current &&
        suppressedRun.current === undefined
      ) {
        onStatusRef.current(progress as PlaygroundStatus);
      }

      if (message.type === 'done') {
        if (message.compilatonError) {
          if (suppressedRun.current !== undefined && !activeRun.current) {
            releaseSuppressedRun(suppressedRun.current);
            return;
          }
          const request = activeRun.current ?? runRequestRef.current;
          if (request) finish(request, 'Failed');
          else onStatusRef.current('Failed');
          return;
        }
        if (!runtimeReady.current) {
          runtimeReady.current = true;
          onReadyRef.current(sandboxKeyRef.current);
          tryLaunchRef.current();
        }
        return;
      }

      if (
        message.type === 'action' &&
        (message.action === 'show-error' ||
          (message.action === 'notification' &&
            message.notificationType === 'error'))
      ) {
        if (suppressedRun.current !== undefined && !activeRun.current) return;
        const errorText =
          message.action === 'show-error'
            ? message.message || message.title
            : message.title;
        if (errorText) {
          const id = `runtime-error:${errorText}`;
          if (!seenConsoleIds.current.has(id)) {
            seenConsoleIds.current.add(id);
            setConsoleLines((current) => [...current, errorText]);
          }
        }
        const request = activeRun.current;
        if (request) {
          runFailed.current = true;
          onStatusRef.current('Failed');
        } else if (runRequestRef.current) {
          finish(runRequestRef.current, 'Failed');
        } else {
          onStatusRef.current('Failed');
        }
        return;
      }

      if (message.type !== 'console' || !message.codesandbox) return;
      const logs = (
        Array.isArray(message.log) ? message.log : [message.log]
      ) as readonly ConsoleLog[];
      const additions: string[] = [];
      let completedRequest: RunRequest | undefined;

      for (const log of logs) {
        const token = completionToken(log);
        if (token !== undefined) {
          releaseSuppressedRun(token);
          if (activeRun.current?.token === token) {
            completedRequest = activeRun.current;
          }
          continue;
        }
        const error = runErrorRecord(log);
        if (error) {
          if (error.token !== visibleRunToken.current) continue;
          const line = formatConsoleValue(error.error);
          const id = `run-error:${error.token}:${line}`;
          if (!seenConsoleIds.current.has(id)) {
            seenConsoleIds.current.add(id);
            additions.push(line);
          }
          runFailed.current = true;
          onStatusRef.current('Failed');
          continue;
        }
        const output = runOutputRecord(log);
        if (!output || output.token !== visibleRunToken.current) continue;
        if (output.method === 'clear') {
          additions.length = 0;
          clearConsole();
          continue;
        }
        const line = output.data.map(formatConsoleValue).join(' ');
        if (!line || (output.method === 'debug' && line.startsWith('[vite]'))) {
          continue;
        }
        const id = log.id ?? `${output.token}:${output.method}:${line}`;
        if (seenConsoleIds.current.has(id)) continue;
        seenConsoleIds.current.add(id);
        additions.push(line);
      }

      if (additions.length > 0) {
        setConsoleLines((current) => [...current, ...additions]);
      }
      if (completedRequest) {
        finish(completedRequest, runFailed.current ? 'Failed' : 'Ready');
      }
    };

    useImperativeHandle(
      forwardedRef,
      () => ({
        readCode: () => editorRef.current?.readValue() ?? liveCode.current,
        captureEditor: () => editorRef.current?.capture(),
      }),
      []
    );

    useEffect(() => {
      if (code === previousCode.current) return;
      previousCode.current = code;
      if (expectedProgrammaticCode.current === code) {
        expectedProgrammaticCode.current = undefined;
        return;
      }
      onCodeChangeRef.current(code);
    }, [code]);

    useEffect(() => {
      if (!restoreSnapshot) return;
      editorRef.current?.restore(restoreSnapshot);
    }, [restoreSnapshot]);

    useEffect(() => {
      runtimeReady.current = false;
      onStatusRef.current('Preparing runtime');
      const stop = listenRef.current((message) =>
        handleMessageRef.current(message)
      );
      return () => {
        stop();
        clearFailureTimer();
        clearClientRetry();
        clearSuppressionTimer();
        pendingExecution.current = undefined;
        activeRun.current = undefined;
      };
    }, [
      clearClientRetry,
      clearFailureTimer,
      clearSuppressionTimer,
      sandboxKey,
    ]);

    useEffect(() => {
      const currentRun = activeRun.current;
      if (currentRun && runRequest?.token !== currentRun.token) {
        clearFailureTimer();
        clearSuppressionTimer();
        const awaitingWrite =
          pendingExecution.current?.token === currentRun.token;
        if (awaitingWrite) {
          pendingExecution.current = undefined;
        } else {
          suppressedRun.current = currentRun.token;
          suppressionTimer.current = window.setTimeout(() => {
            suppressionTimer.current = undefined;
            if (suppressedRun.current !== currentRun.token) return;
            suppressedRun.current = undefined;
            tryLaunchRef.current();
          }, 30_000);
        }
        activeRun.current = undefined;
        runFailed.current = false;
      }
      if (
        runRequest &&
        failureTimer.current === undefined &&
        suppressedRun.current === undefined
      ) {
        failureTimer.current = window.setTimeout(
          () => finish(runRequest, 'Failed'),
          30_000
        );
      }
      if (!runRequest) {
        clearFailureTimer();
        clearClientRetry();
      }
      tryLaunchRef.current();
    }, [
      clearClientRetry,
      clearFailureTimer,
      clearSuppressionTimer,
      finish,
      runRequest,
    ]);

    useEffect(() => {
      if (previousCodeIdentity.current === codeIdentity) return;
      previousCodeIdentity.current = codeIdentity;
      visibleRunToken.current = undefined;
      clearConsole();
      if (code !== activeCode) {
        expectedProgrammaticCode.current = activeCode;
        updateCode(activeCode, false);
      } else {
        expectedProgrammaticCode.current = undefined;
      }
      onStatusRef.current(runtimeReady.current ? 'Ready' : 'Preparing runtime');
    }, [activeCode, clearConsole, code, codeIdentity, updateCode]);

    return (
      <>
        <section
          className="playground__region playground__editor-region"
          aria-labelledby="playground-code-heading"
        >
          <h2 id="playground-code-heading">Code</h2>
          <div className="playground__editor">
            <TypeScriptEditor
              ref={editorRef}
              value={code}
              onChange={(nextCode) => updateCode(nextCode, false)}
              height="100%"
              modelPath="file:///playground/index.ts"
              ariaLabel="TypeScript playground editor"
              typingVersions={typingVersions}
              fallback={
                <SandpackCodeEditor
                  initMode="immediate"
                  readOnly
                  showLineNumbers
                  showRunButton={false}
                  showTabs={false}
                />
              }
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
            <iframe
              ref={iframe}
              className="playground__runtime-client"
              title="Playground runtime"
              aria-hidden="true"
            />
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
    const [{ customSetup, files }] = useState(() => ({
      customSetup: { entry: '/runner.ts', dependencies },
      files: {
        '/index.ts': { code: initialCode, active: true },
        '/execution.ts': { code: '', hidden: true },
        '/runner.ts': {
          code: runtimeSource(Object.keys(dependencies)),
          hidden: true,
        },
        '/vite.config.js': {
          code: 'export default { server: { hmr: false } };',
          hidden: true,
        },
        '/index.html': {
          code: '<!doctype html><script type="module" src="/runner.ts"></script>',
          hidden: true,
        },
      },
    }));

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
  const [status, setStatus] = useState<PlaygroundStatus>('Loading editor');
  const [runRequest, setRunRequest] = useState<RunRequest | null>(null);
  const [theme, setTheme] = useState<PlaygroundTheme>('light');
  const sandboxRef = useRef<SandboxHandle>(null);
  const scanTimer = useRef<number>();
  const deferredScan = useRef<DeferredScan>();
  const restoreSnapshot = useRef<TypeScriptEditorSnapshot>();
  const runCounter = useRef(0);
  const runRequestRef = useRef(runRequest);
  const selectedIdRef = useRef(selectedId);
  const dependenciesRef = useRef(dependencies);
  const readySandboxKeyRef = useRef<string>();
  runRequestRef.current = runRequest;
  selectedIdRef.current = selectedId;
  dependenciesRef.current = dependencies;

  const sandboxKey = keyFor(dependencies[selectedId]);
  const sandboxKeyRef = useRef(sandboxKey);
  if (sandboxKeyRef.current !== sandboxKey) {
    sandboxKeyRef.current = sandboxKey;
    readySandboxKeyRef.current = undefined;
  }
  const codeIdentity = `${selectedId}:${resetGeneration[selectedId]}`;
  const typingVersions = Object.fromEntries(
    Object.entries(dependencies[selectedId]).filter(
      ([name]) => name !== '@favy/di'
    )
  );
  const runDisabled =
    runRequest !== null ||
    status === 'Preparing dependencies' ||
    status === 'Running';
  const runLabel =
    runRequest === null
      ? 'Run'
      : status === 'Running'
      ? 'Running…'
      : 'Preparing…';

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
    if (sandboxKeyRef.current !== readyKey) return;
    readySandboxKeyRef.current = readyKey;
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
        setStatus(
          readySandboxKeyRef.current === sandboxKeyRef.current
            ? 'Ready'
            : 'Preparing runtime'
        );
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
      setStatus(
        readySandboxKeyRef.current === keyFor(dependenciesRef.current[nextId])
          ? 'Ready'
          : 'Preparing runtime'
      );
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
    setStatus(
      readySandboxKeyRef.current === keyFor(detectedDependencies[selectedId])
        ? 'Ready'
        : 'Preparing runtime'
    );
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
    const targetKey = changed ? keyFor(nextDependencies) : sandboxKey;
    runCounter.current += 1;
    const request = {
      token: runCounter.current,
      sandboxKey: targetKey,
      code,
    };
    runRequestRef.current = request;
    setRunRequest(request);
    setStatus(
      changed
        ? 'Preparing dependencies'
        : readySandboxKeyRef.current === targetKey
        ? 'Running'
        : 'Preparing runtime'
    );
  }, [
    cancelScan,
    drafts,
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
            {runRequest && (
              <span className="playground__spinner" aria-hidden="true" />
            )}
            {runLabel}
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
            activeCode={drafts[selectedId]}
            codeIdentity={codeIdentity}
            sandboxKey={sandboxKey}
            typingVersions={typingVersions}
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
