import { CodeEditor as SandpackCode } from '@codesandbox/sandpack-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
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
  isPlaygroundSourceWithinLimit,
  PLAYGROUND_SOURCE_TOO_LARGE_PLACEHOLDER,
} from './playground-runtime';
import {
  PlaygroundSandbox,
  type PlaygroundOutputUpdate,
  type PlaygroundRunPhase,
  type PlaygroundRunRequest,
  type PlaygroundRunSettlement,
  type PlaygroundSandboxStatus,
  type PlaygroundTheme,
} from './playground-sandbox';
import './playground.css';

type PlaygroundStatus =
  | 'Loading editor'
  | 'Checking imports'
  | 'Preparing dependencies'
  | PlaygroundSandboxStatus
  | 'Source is too large (64 KiB maximum)'
  | `Unsupported import: ${string}`
  | 'Failed — runtime unavailable'
  | 'Failed — runtime restarted';

type DeferredScan = Readonly<{
  runToken: number;
  selectedId: PlaygroundExampleId;
  code: string;
}>;

type Drafts = Record<PlaygroundExampleId, string>;
type DependencyMap = Record<PlaygroundExampleId, PlaygroundDependencies>;
type ResetGenerations = Record<PlaygroundExampleId, number>;
type ImportBlockStatus = 'Checking imports' | `Unsupported import: ${string}`;
type ImportBlockMap = Partial<Record<PlaygroundExampleId, ImportBlockStatus>>;
type PendingEditorRestore = Readonly<{
  codeIdentity: string;
  snapshot: TypeScriptEditorSnapshot;
}>;
type PendingTransition =
  | { type: 'select'; id: PlaygroundExampleId }
  | { type: 'reset'; id: PlaygroundExampleId };

const SOURCE_TOO_LARGE_STATUS = 'Source is too large (64 KiB maximum)';

const initialDrafts = (): Drafts =>
  Object.fromEntries(
    playgroundExamples.map(({ id, source }) => [id, source])
  ) as Drafts;

const dependenciesFor = (source: string): PlaygroundDependencies => {
  const resolution = resolvePlaygroundDependencies(source);
  if (resolution.kind !== 'ready') {
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
  const [importsBlocked, setImportsBlocked] = useState(false);
  const [runRequest, setRunRequest] = useState<PlaygroundRunRequest | null>(
    null
  );
  const [runPhase, setRunPhase] = useState<PlaygroundRunPhase | null>(null);
  const [cancelRunToken, setCancelRunToken] = useState<number | null>(null);
  const [consoleLines, setConsoleLines] = useState<readonly string[]>([]);
  const [theme, setTheme] = useState<PlaygroundTheme>('light');
  const editorRef = useRef<TypeScriptEditorHandle>(null);
  const scanTimer = useRef<number>();
  const deferredScan = useRef<DeferredScan>();
  const pendingEditorRestore = useRef<PendingEditorRestore>();
  const pendingTransition = useRef<PendingTransition>();
  const runCounter = useRef(0);
  const runRequestRef = useRef(runRequest);
  const selectedIdRef = useRef(selectedId);
  const dependenciesRef = useRef(dependencies);
  const readySandboxKeyRef = useRef<string>();
  const importsBlockedRef = useRef(importsBlocked);
  const importBlocksRef = useRef<ImportBlockMap>({});
  runRequestRef.current = runRequest;
  selectedIdRef.current = selectedId;
  dependenciesRef.current = dependencies;
  importsBlockedRef.current = importsBlocked;

  const sandboxKey = keyFor(dependencies[selectedId]);
  const sandboxKeyRef = useRef(sandboxKey);
  if (sandboxKeyRef.current !== sandboxKey) {
    sandboxKeyRef.current = sandboxKey;
    readySandboxKeyRef.current = undefined;
  }
  const codeIdentity = `${selectedId}:${resetGeneration[selectedId]}`;
  const codeIdentityRef = useRef(codeIdentity);
  codeIdentityRef.current = codeIdentity;
  const selectedSource = drafts[selectedId];
  const sourceWithinLimit = isPlaygroundSourceWithinLimit(selectedSource);
  const sandboxSource = sourceWithinLimit
    ? selectedSource
    : PLAYGROUND_SOURCE_TOO_LARGE_PLACEHOLDER;
  const typingVersions = sourceWithinLimit
    ? Object.fromEntries(
        Object.entries(dependencies[selectedId]).filter(
          ([, version]) => version === 'latest'
        )
      )
    : undefined;
  const visibleStatus = sourceWithinLimit ? status : SOURCE_TOO_LARGE_STATUS;
  const isBusy =
    runRequest !== null ||
    status === 'Preparing dependencies' ||
    status === 'Preparing runtime' ||
    status === 'Downloading packages' ||
    status === 'Installing packages' ||
    status === 'Starting Vite';
  const runDisabled = isBusy || !sourceWithinLimit || importsBlocked;
  const runLabel =
    runRequest === null
      ? 'Run'
      : runPhase === 'executing'
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

  useEffect(() => {
    const restore = pendingEditorRestore.current;
    if (!restore || restore.codeIdentity !== codeIdentity) return;
    pendingEditorRestore.current = undefined;
    editorRef.current?.restore(restore.snapshot);
  }, [codeIdentity, sandboxKey]);

  const captureEditorForRemount = useCallback((): void => {
    const snapshot = editorRef.current?.capture();
    pendingEditorRestore.current = snapshot
      ? { codeIdentity: codeIdentityRef.current, snapshot }
      : undefined;
  }, []);

  const handleSandboxReady = useCallback((readyKey: string) => {
    if (sandboxKeyRef.current !== readyKey) return;
    readySandboxKeyRef.current = readyKey;
    if (
      !importsBlockedRef.current &&
      runRequestRef.current?.sandboxKey !== readyKey
    ) {
      setStatus('Ready');
    }
  }, []);

  const handleSandboxStatus = useCallback(
    (nextStatus: PlaygroundSandboxStatus) => {
      if (!importsBlockedRef.current) setStatus(nextStatus);
    },
    []
  );

  const handlePhaseChange = useCallback(
    (runToken: number, phase: PlaygroundRunPhase): void => {
      if (runRequestRef.current?.runToken !== runToken) return;
      setRunPhase(phase);
    },
    []
  );

  const handleOutput = useCallback((update: PlaygroundOutputUpdate): void => {
    if (runRequestRef.current?.runToken !== update.runToken) return;
    if (update.type === 'reset' || update.type === 'clear') {
      setConsoleLines([]);
    } else if (update.type === 'truncated') {
      setConsoleLines((lines) => [...lines, '[Output truncated]']);
    } else {
      const line = update.data.map(formatConsoleValue).join(' ');
      if (line) setConsoleLines((lines) => [...lines, line]);
    }
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
      if (!isPlaygroundSourceWithinLimit(code)) {
        setStatus(SOURCE_TOO_LARGE_STATUS);
        return;
      }
      const resolution = resolvePlaygroundDependencies(code);
      if (resolution.kind !== 'ready') {
        const nextStatus: ImportBlockStatus =
          resolution.kind === 'unsupported'
            ? `Unsupported import: ${resolution.specifier}`
            : 'Checking imports';
        importBlocksRef.current[scanSelectedId] = nextStatus;
        importsBlockedRef.current = true;
        setImportsBlocked(true);
        setStatus(nextStatus);
        return;
      }
      delete importBlocksRef.current[scanSelectedId];
      importsBlockedRef.current = false;
      setImportsBlocked(false);
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
      captureEditorForRemount();
      updateDependencies(scanSelectedId, resolution.dependencies);
      setStatus('Preparing dependencies');
    },
    [captureEditorForRemount, updateDependencies]
  );

  const handleCodeChange = useCallback(
    (code: string) => {
      const editSelectedId = selectedIdRef.current;
      setDrafts((current) => ({ ...current, [editSelectedId]: code }));
      delete importBlocksRef.current[editSelectedId];
      importsBlockedRef.current = false;
      setImportsBlocked(false);
      cancelScan();
      deferredScan.current = undefined;
      if (!isPlaygroundSourceWithinLimit(code)) {
        setStatus(SOURCE_TOO_LARGE_STATUS);
        return;
      }
      setStatus('Checking imports');
      scanTimer.current = window.setTimeout(() => {
        scanTimer.current = undefined;
        const activeRequest = runRequestRef.current;
        if (activeRequest) {
          deferredScan.current = {
            runToken: activeRequest.runToken,
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

  const applyExampleSelection = useCallback(
    (nextId: PlaygroundExampleId) => {
      const currentId = selectedIdRef.current;
      if (nextId === currentId) return;
      const currentCode = editorRef.current?.readValue() ?? drafts[currentId];
      setDrafts((current) => ({
        ...current,
        [currentId]: currentCode,
      }));
      cancelScan();
      deferredScan.current = undefined;
      pendingEditorRestore.current = undefined;
      setConsoleLines([]);
      const nextSourceWithinLimit = isPlaygroundSourceWithinLimit(
        drafts[nextId]
      );
      const importBlock = nextSourceWithinLimit
        ? importBlocksRef.current[nextId]
        : undefined;
      importsBlockedRef.current = importBlock !== undefined;
      setImportsBlocked(importBlock !== undefined);
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      setStatus(
        !nextSourceWithinLimit
          ? SOURCE_TOO_LARGE_STATUS
          : importBlock ??
              (readySandboxKeyRef.current ===
              keyFor(dependenciesRef.current[nextId])
                ? 'Ready'
                : 'Preparing runtime')
      );
    },
    [cancelScan, drafts]
  );

  const applyExampleReset = useCallback(
    (resetId: PlaygroundExampleId): void => {
      if (selectedIdRef.current !== resetId) return;
      cancelScan();
      deferredScan.current = undefined;
      pendingEditorRestore.current = undefined;
      setConsoleLines([]);
      delete importBlocksRef.current[resetId];
      importsBlockedRef.current = false;
      setImportsBlocked(false);
      setDrafts((current) => ({
        ...current,
        [resetId]: playgroundExampleById[resetId].source,
      }));
      updateDependencies(resetId, detectedDependencies[resetId]);
      setResetGeneration((current) => ({
        ...current,
        [resetId]: current[resetId] + 1,
      }));
      setStatus(
        readySandboxKeyRef.current === keyFor(detectedDependencies[resetId])
          ? 'Ready'
          : 'Preparing runtime'
      );
    },
    [cancelScan, detectedDependencies, updateDependencies]
  );

  const applyTransition = useCallback(
    (transition: PendingTransition): void => {
      if (transition.type === 'select') {
        applyExampleSelection(transition.id);
      } else {
        applyExampleReset(transition.id);
      }
    },
    [applyExampleReset, applyExampleSelection]
  );

  const requestTransition = useCallback(
    (transition: PendingTransition): void => {
      const activeRequest = runRequestRef.current;
      if (activeRequest) {
        pendingTransition.current = transition;
        setCancelRunToken(activeRequest.runToken);
        return;
      }
      pendingTransition.current = undefined;
      setCancelRunToken(null);
      applyTransition(transition);
    },
    [applyTransition]
  );

  const selectExample = useCallback(
    (nextId: PlaygroundExampleId): void => {
      if (nextId === selectedIdRef.current) return;
      requestTransition({ type: 'select', id: nextId });
    },
    [requestTransition]
  );

  const resetExample = useCallback((): void => {
    requestTransition({ type: 'reset', id: selectedIdRef.current });
  }, [requestTransition]);

  const handleSettled = useCallback(
    (settlement: PlaygroundRunSettlement): void => {
      if (runRequestRef.current?.runToken !== settlement.runToken) return;
      runRequestRef.current = null;
      setRunRequest(null);
      setRunPhase(null);
      setCancelRunToken(null);
      const transition = pendingTransition.current;
      pendingTransition.current = undefined;
      if (transition) {
        applyTransition(transition);
        return;
      }
      const scan = deferredScan.current;
      if (scan?.runToken === settlement.runToken) {
        deferredScan.current = undefined;
        applyDependencyScan(scan.selectedId, scan.code);
        return;
      }
      if (scanTimer.current !== undefined) {
        setStatus('Checking imports');
        return;
      }
      if (settlement.outcome === 'runtime-unavailable') {
        setStatus('Failed — runtime unavailable');
      } else if (settlement.outcome === 'runtime-restarted') {
        setStatus('Failed — runtime restarted');
      } else if (settlement.outcome === 'completed' && settlement.failed) {
        setStatus('Failed');
      } else {
        setStatus(
          readySandboxKeyRef.current === sandboxKeyRef.current
            ? 'Ready'
            : 'Preparing runtime'
        );
      }
    },
    [applyDependencyScan, applyTransition]
  );

  const run = useCallback(() => {
    if (runRequestRef.current || runDisabled) return;
    cancelScan();
    deferredScan.current = undefined;
    const code = editorRef.current?.readValue() ?? drafts[selectedId];
    setDrafts((current) => ({ ...current, [selectedId]: code }));
    if (!isPlaygroundSourceWithinLimit(code)) {
      delete importBlocksRef.current[selectedId];
      importsBlockedRef.current = false;
      setImportsBlocked(false);
      setStatus(SOURCE_TOO_LARGE_STATUS);
      return;
    }
    const resolution = resolvePlaygroundDependencies(code);
    if (resolution.kind !== 'ready') {
      const nextStatus: ImportBlockStatus =
        resolution.kind === 'unsupported'
          ? `Unsupported import: ${resolution.specifier}`
          : 'Checking imports';
      importBlocksRef.current[selectedId] = nextStatus;
      importsBlockedRef.current = true;
      setImportsBlocked(true);
      setStatus(nextStatus);
      return;
    }
    delete importBlocksRef.current[selectedId];
    importsBlockedRef.current = false;
    setImportsBlocked(false);
    const currentDependencies = dependenciesRef.current[selectedId];
    const nextDependencies = resolution.dependencies;
    const changed =
      dependencySignature(nextDependencies) !==
      dependencySignature(currentDependencies);
    if (changed) {
      captureEditorForRemount();
      updateDependencies(selectedId, nextDependencies);
    }
    const targetKey = changed ? keyFor(nextDependencies) : sandboxKey;
    const nextRunToken = runCounter.current + 1;
    if (!Number.isSafeInteger(nextRunToken)) {
      setStatus('Failed — runtime unavailable');
      return;
    }
    runCounter.current = nextRunToken;
    pendingTransition.current = undefined;
    setCancelRunToken(null);
    const request: PlaygroundRunRequest = {
      runToken: nextRunToken,
      sandboxKey: targetKey,
      code,
    };
    runRequestRef.current = request;
    setRunRequest(request);
    setRunPhase('queued');
    setStatus(
      changed
        ? 'Preparing dependencies'
        : readySandboxKeyRef.current === targetKey
        ? 'Ready'
        : 'Preparing runtime'
    );
  }, [
    cancelScan,
    captureEditorForRemount,
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
      className="playground"
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
          aria-busy={isBusy}
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
            {isBusy && (
              <span className="playground__spinner" aria-hidden="true" />
            )}
            {runLabel}
          </button>
          <span className="playground__shortcut">
            Shortcut: <kbd>Ctrl/⌘ + Enter</kbd>
          </span>
          <span className="playground__status" role="status" aria-live="polite">
            {visibleStatus}
          </span>
        </div>
        <div className="playground__sandbox">
          <PlaygroundSandbox
            key={sandboxKey}
            sandboxKey={sandboxKey}
            dependencies={dependencies[selectedId]}
            initialCode={sandboxSource}
            theme={theme}
            runRequest={runRequest}
            cancelRunToken={cancelRunToken}
            onReady={handleSandboxReady}
            onPhaseChange={handlePhaseChange}
            onOutput={handleOutput}
            onSettled={handleSettled}
            onStatus={handleSandboxStatus}
          >
            <section
              className="playground__region playground__editor-region"
              aria-labelledby="playground-code-heading"
            >
              <h2 id="playground-code-heading">Code</h2>
              <div className="playground__editor">
                <TypeScriptEditor
                  ref={editorRef}
                  value={drafts[selectedId]}
                  onChange={handleCodeChange}
                  height="100%"
                  modelPath="file:///playground/index.ts"
                  ariaLabel="TypeScript playground editor"
                  typingVersions={typingVersions}
                  fallback={
                    <div
                      className="playground__editor-fallback"
                      role="region"
                      aria-label="TypeScript playground editor"
                      tabIndex={0}
                    >
                      <SandpackCode
                        code={sandboxSource}
                        filePath="/index.ts"
                        initMode="immediate"
                        readOnly
                        showLineNumbers
                        showReadOnly={false}
                      />
                    </div>
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
              </div>
            </section>
          </PlaygroundSandbox>
        </div>
      </div>
    </section>
  );
}
