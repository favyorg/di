import type { SandpackMessage } from '@codesandbox/sandpack-client';
import {
  SandpackProvider,
  useSandpackClient,
} from '@codesandbox/sandpack-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PropsWithChildren,
} from 'react';
import { favyDiSourceFiles } from './favy-di-sources';
import type { PlaygroundDependencies } from './playground-dependencies';
import {
  isPlaygroundSourceWithinLimit,
  preparationLabel,
  PLAYGROUND_SOURCE_TOO_LARGE_PLACEHOLDER,
  runtimeCancelCommand,
  runtimePrepareCommand,
  runtimeRelayRecord,
  runtimeRunCommand,
  runtimeSource,
  setupForRun,
  warmupSource,
  workerSource,
  type PlaygroundConsoleValue,
  type RuntimeConsoleMethod,
  type RuntimeRelay,
} from './playground-runtime';

export type PlaygroundRunRequest = Readonly<{
  runToken: number;
  sandboxKey: string;
  code: string;
}>;

export type PlaygroundTheme = 'light' | 'dark';

export type PlaygroundSandboxStatus =
  | 'Preparing runtime'
  | 'Downloading packages'
  | 'Installing packages'
  | 'Starting Vite'
  | 'Ready'
  | 'Running'
  | 'Failed';

export type PlaygroundRunPhase = 'queued' | 'committing' | 'executing';

export type PlaygroundOutputUpdate =
  | { type: 'reset'; runToken: number }
  | { type: 'clear'; runToken: number }
  | {
      type: 'append';
      runToken: number;
      method: RuntimeConsoleMethod;
      data: readonly PlaygroundConsoleValue[];
    }
  | { type: 'truncated'; runToken: number };

export type PlaygroundRunSettlement =
  | { runToken: number; outcome: 'completed'; failed: boolean }
  | { runToken: number; outcome: 'cancelled' }
  | { runToken: number; outcome: 'runtime-unavailable' }
  | { runToken: number; outcome: 'runtime-restarted' };

export type PlaygroundSandboxProps = PropsWithChildren<{
  sandboxKey: string;
  dependencies: PlaygroundDependencies;
  initialCode: string;
  theme: PlaygroundTheme;
  runRequest: PlaygroundRunRequest | null;
  cancelRunToken: number | null;
  onReady(sandboxKey: string): void;
  onPhaseChange(runToken: number, phase: PlaygroundRunPhase): void;
  onOutput(update: PlaygroundOutputUpdate): void;
  onSettled(settlement: PlaygroundRunSettlement): void;
  onStatus(status: PlaygroundSandboxStatus): void;
}>;

type InfrastructureRetries = 0 | 1;

type RunLedger = Readonly<{
  request: PlaygroundRunRequest;
  infrastructureRetries: InfrastructureRetries;
}>;

type OutputBudget = {
  acceptedEvents: number;
  acceptedBytes: number;
  closed: boolean;
  seenEventIds: Set<number>;
};

type RunLifecycle =
  | { phase: 'idle' }
  | {
      phase: 'queued';
      request: PlaygroundRunRequest;
      infrastructureRetries: InfrastructureRetries;
    }
  | {
      phase: 'committing';
      request: PlaygroundRunRequest;
      infrastructureRetries: InfrastructureRetries;
      sessionToken: number;
      expectedContent: string;
    }
  | {
      phase: 'executing';
      request: PlaygroundRunRequest;
      infrastructureRetries: InfrastructureRetries;
      sessionToken: number;
      failed: boolean;
    }
  | {
      phase: 'cancelling';
      request: PlaygroundRunRequest;
      sessionToken: number;
    };

type SandboxControllerProps = Pick<
  PlaygroundSandboxProps,
  | 'sandboxKey'
  | 'cancelRunToken'
  | 'onReady'
  | 'onPhaseChange'
  | 'onOutput'
  | 'onStatus'
> & {
  runLedger: RunLedger | null;
  onRestartBeforeExecution(ledger: RunLedger): void;
  onRestartAfterExecution(request: PlaygroundRunRequest): void;
  onCancellationTimeout(request: PlaygroundRunRequest): void;
  onControllerSettled(
    request: PlaygroundRunRequest,
    settlement: PlaygroundRunSettlement
  ): void;
};

const SANDBOX_OPTIONS = Object.freeze({
  activeFile: '/index.ts',
  autorun: true,
  autoReload: false,
});

const VITE_CONFIG_SOURCE =
  "export default { resolve: { alias: [{ find: /^@favy\\/di$/, replacement: '/favy-di/index.ts' }] }, server: { cors: { origin: '*' }, hmr: false } };";

const PREPARATION_TIMEOUT_MS = 120_000;
const COMMIT_TIMEOUT_MS = 10_000;
const EXECUTION_TIMEOUT_MS = 30_000;
const CANCELLATION_TIMEOUT_MS = 1_000;
const MAX_OUTPUT_EVENTS = 199;
const MAX_OUTPUT_BYTES = 65_536;

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

const clearTimer = (timer: MutableRefObject<number | undefined>): void => {
  if (timer.current === undefined) return;
  window.clearTimeout(timer.current);
  timer.current = undefined;
};

let nextSessionToken = 0;

const takeSessionToken = (): number => {
  if (!Number.isSafeInteger(nextSessionToken)) {
    throw new RangeError('Playground session token space exhausted.');
  }
  const token = nextSessionToken;
  nextSessionToken += 1;
  return token;
};

const runtimeTargetOrigin = (iframe: HTMLIFrameElement): string => {
  if (!iframe.src) return '*';
  try {
    const origin = new URL(iframe.src).origin;
    return origin === 'null' ? '*' : origin;
  } catch {
    return '*';
  }
};

const SandboxController = ({
  sandboxKey,
  runLedger,
  cancelRunToken,
  onReady,
  onPhaseChange,
  onOutput,
  onStatus,
  onRestartBeforeExecution,
  onRestartAfterExecution,
  onCancellationTimeout,
  onControllerSettled,
}: SandboxControllerProps): JSX.Element => {
  const { iframe, getClient, listen } = useSandpackClient();
  const bootHandled = useRef(false);
  const sessionToken = useRef<number>();
  const sessionReady = useRef(false);
  const lifecycle = useRef<RunLifecycle>({ phase: 'idle' });
  const preparationTimer = useRef<number>();
  const commitTimer = useRef<number>();
  const executionTimer = useRef<number>();
  const cancellationTimer = useRef<number>();
  const outputBudget = useRef<OutputBudget>();
  const runLedgerRef = useRef(runLedger);
  const sandboxKeyRef = useRef(sandboxKey);
  const listenRef = useRef(listen);
  const getClientRef = useRef(getClient);
  const onReadyRef = useRef(onReady);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const onOutputRef = useRef(onOutput);
  const onStatusRef = useRef(onStatus);
  const onRestartBeforeExecutionRef = useRef(onRestartBeforeExecution);
  const onRestartAfterExecutionRef = useRef(onRestartAfterExecution);
  const onCancellationTimeoutRef = useRef(onCancellationTimeout);
  const onControllerSettledRef = useRef(onControllerSettled);
  const restartBeforeExecutionRef = useRef<() => void>(() => undefined);
  const tryCommitRef = useRef<() => boolean>(() => false);
  const handleMessageRef = useRef<(message: SandpackMessage) => void>(
    () => undefined
  );
  runLedgerRef.current = runLedger;
  sandboxKeyRef.current = sandboxKey;
  listenRef.current = listen;
  getClientRef.current = getClient;
  onReadyRef.current = onReady;
  onPhaseChangeRef.current = onPhaseChange;
  onOutputRef.current = onOutput;
  onStatusRef.current = onStatus;
  onRestartBeforeExecutionRef.current = onRestartBeforeExecution;
  onRestartAfterExecutionRef.current = onRestartAfterExecution;
  onCancellationTimeoutRef.current = onCancellationTimeout;
  onControllerSettledRef.current = onControllerSettled;

  const clearAllTimers = useCallback((): void => {
    clearTimer(preparationTimer);
    clearTimer(commitTimer);
    clearTimer(executionTimer);
    clearTimer(cancellationTimer);
  }, []);

  const clearOutputBudget = useCallback((): void => {
    outputBudget.current?.seenEventIds.clear();
    outputBudget.current = undefined;
  }, []);

  const resetOutputBudget = useCallback((): void => {
    clearOutputBudget();
    outputBudget.current = {
      acceptedEvents: 0,
      acceptedBytes: 0,
      closed: false,
      seenEventIds: new Set<number>(),
    };
  }, [clearOutputBudget]);

  const acceptOutputEvent = useCallback(
    (
      eventId: number,
      data: readonly PlaygroundConsoleValue[],
      runToken: number
    ): boolean => {
      const budget = outputBudget.current;
      if (!budget || budget.closed || budget.seenEventIds.has(eventId)) {
        return false;
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(data);
      } catch {
        return false;
      }
      const bytes = utf8Bytes(serialized);
      if (
        budget.acceptedEvents >= MAX_OUTPUT_EVENTS ||
        budget.acceptedBytes + bytes > MAX_OUTPUT_BYTES
      ) {
        budget.closed = true;
        onOutputRef.current({ type: 'truncated', runToken });
        return false;
      }
      budget.acceptedEvents += 1;
      budget.acceptedBytes += bytes;
      budget.seenEventIds.add(eventId);
      return true;
    },
    []
  );

  const transition = useCallback(
    (next: RunLifecycle): void => {
      clearAllTimers();
      lifecycle.current = next;
    },
    [clearAllTimers]
  );

  const postRuntimeCommand = useCallback(
    (command: ReturnType<typeof runtimePrepareCommand>): boolean => {
      try {
        const runtime = iframe.current;
        if (!runtime?.contentWindow) return false;
        runtime.contentWindow.postMessage(
          command,
          runtimeTargetOrigin(runtime)
        );
        return true;
      } catch {
        return false;
      }
    },
    [iframe]
  );

  const settle = useCallback(
    (
      run: Exclude<RunLifecycle, { phase: 'idle' }>,
      settlement: PlaygroundRunSettlement,
      status: PlaygroundSandboxStatus
    ): void => {
      if (lifecycle.current !== run) return;
      clearOutputBudget();
      transition({ phase: 'idle' });
      onStatusRef.current(status);
      onControllerSettledRef.current(run.request, settlement);
    },
    [clearOutputBudget, transition]
  );

  const restartBeforeExecution = useCallback((): void => {
    const run = lifecycle.current;
    if (run.phase !== 'queued' && run.phase !== 'committing') return;
    clearOutputBudget();
    transition({ phase: 'idle' });
    if (run.infrastructureRetries === 0) {
      onStatusRef.current('Preparing runtime');
      onRestartBeforeExecutionRef.current({
        request: run.request,
        infrastructureRetries: 1,
      });
      return;
    }
    onStatusRef.current('Failed');
    onControllerSettledRef.current(run.request, {
      runToken: run.request.runToken,
      outcome: 'runtime-unavailable',
    });
  }, [clearOutputBudget, transition]);
  restartBeforeExecutionRef.current = restartBeforeExecution;

  const ensurePreparationWatchdog = useCallback(
    (run: Extract<RunLifecycle, { phase: 'queued' }>): void => {
      if (
        lifecycle.current !== run ||
        sessionReady.current ||
        preparationTimer.current !== undefined
      ) {
        return;
      }
      preparationTimer.current = window.setTimeout(() => {
        preparationTimer.current = undefined;
        if (lifecycle.current !== run || sessionReady.current) return;
        restartBeforeExecutionRef.current();
      }, PREPARATION_TIMEOUT_MS);
    },
    []
  );

  const tryCommit = useCallback((): boolean => {
    const run = lifecycle.current;
    if (run.phase !== 'queued' || !sessionReady.current) return false;
    const currentSessionToken = sessionToken.current;
    if (currentSessionToken === undefined) return false;

    try {
      const client = getClientRef.current();
      if (!client) {
        restartBeforeExecutionRef.current();
        return true;
      }
      const nextSetup = setupForRun(
        client.sandboxSetup,
        run.request.code,
        currentSessionToken,
        run.request.runToken
      );
      const expectedContent = nextSetup.files['/execution.ts'].code;
      client.updateSandbox(nextSetup);
      const committing: RunLifecycle = {
        phase: 'committing',
        request: run.request,
        infrastructureRetries: run.infrastructureRetries,
        sessionToken: currentSessionToken,
        expectedContent,
      };
      transition(committing);
      resetOutputBudget();
      onOutputRef.current({ type: 'reset', runToken: run.request.runToken });
      onPhaseChangeRef.current(run.request.runToken, 'committing');
      commitTimer.current = window.setTimeout(() => {
        commitTimer.current = undefined;
        if (lifecycle.current !== committing) return;
        restartBeforeExecutionRef.current();
      }, COMMIT_TIMEOUT_MS);
    } catch {
      restartBeforeExecutionRef.current();
    }
    return true;
  }, [resetOutputBudget, transition]);
  tryCommitRef.current = tryCommit;

  const queueEligibleRequest = useCallback((): void => {
    const ledger = runLedgerRef.current;
    const current = lifecycle.current;
    if (current.phase !== 'idle') {
      if (current.phase === 'queued' && ledger?.request === current.request) {
        ensurePreparationWatchdog(current);
      }
      return;
    }
    if (!ledger || ledger.request.sandboxKey !== sandboxKeyRef.current) return;
    const queued: RunLifecycle = {
      phase: 'queued',
      request: ledger.request,
      infrastructureRetries: ledger.infrastructureRetries,
    };
    transition(queued);
    onPhaseChangeRef.current(ledger.request.runToken, 'queued');
    if (!tryCommitRef.current()) {
      ensurePreparationWatchdog(queued);
      onStatusRef.current('Preparing runtime');
    }
  }, [ensurePreparationWatchdog, transition]);

  const handleRelay = useCallback(
    (relay: RuntimeRelay): void => {
      const currentSessionToken = sessionToken.current;
      if (
        currentSessionToken === undefined ||
        relay.sessionToken !== currentSessionToken
      ) {
        return;
      }

      if (relay.kind === 'ready') {
        if (sessionReady.current) return;
        sessionReady.current = true;
        clearTimer(preparationTimer);
        onReadyRef.current(sandboxKeyRef.current);
        queueEligibleRequest();
        if (!tryCommitRef.current() && lifecycle.current.phase === 'idle') {
          onStatusRef.current('Ready');
        }
        return;
      }

      if (relay.kind === 'prepareError') {
        const run = lifecycle.current;
        if (run.phase === 'queued' || run.phase === 'committing') {
          restartBeforeExecutionRef.current();
        } else if (run.phase === 'idle' && !sessionReady.current) {
          onStatusRef.current('Failed');
        }
        return;
      }

      const run = lifecycle.current;
      if (
        run.phase === 'cancelling' &&
        relay.kind === 'cancelled' &&
        relay.runToken === run.request.runToken
      ) {
        settle(
          run,
          { runToken: run.request.runToken, outcome: 'cancelled' },
          'Ready'
        );
        return;
      }
      if (
        run.phase !== 'executing' ||
        relay.runToken !== run.request.runToken
      ) {
        return;
      }

      if (relay.kind === 'output') {
        const data = relay.method === 'clear' ? [] : relay.data;
        if (!acceptOutputEvent(relay.eventId, data, run.request.runToken)) {
          return;
        }
        if (relay.method === 'clear') {
          onOutputRef.current({
            type: 'clear',
            runToken: run.request.runToken,
          });
        } else {
          onOutputRef.current({
            type: 'append',
            runToken: run.request.runToken,
            method: relay.method,
            data: relay.data,
          });
        }
        return;
      }

      if (relay.kind === 'error') {
        if (
          !acceptOutputEvent(relay.eventId, [relay.error], run.request.runToken)
        ) {
          return;
        }
        run.failed = true;
        onOutputRef.current({
          type: 'append',
          runToken: run.request.runToken,
          method: 'error',
          data: [relay.error],
        });
        onStatusRef.current('Failed');
        return;
      }

      if (relay.kind === 'cancelled') {
        settle(
          run,
          { runToken: run.request.runToken, outcome: 'cancelled' },
          'Ready'
        );
        return;
      }
      settle(
        run,
        {
          runToken: run.request.runToken,
          outcome: 'completed',
          failed: run.failed,
        },
        run.failed ? 'Failed' : 'Ready'
      );
    },
    [acceptOutputEvent, queueEligibleRequest, settle]
  );

  handleMessageRef.current = (message): void => {
    if (message.type === 'fs/change') {
      const run = lifecycle.current;
      if (
        run.phase !== 'committing' ||
        message.path !== '/execution.ts' ||
        message.content !== run.expectedContent
      ) {
        return;
      }
      if (
        !postRuntimeCommand(
          runtimeRunCommand(run.sessionToken, run.request.runToken)
        )
      ) {
        restartBeforeExecutionRef.current();
        return;
      }
      const executing: RunLifecycle = {
        phase: 'executing',
        request: run.request,
        infrastructureRetries: run.infrastructureRetries,
        sessionToken: run.sessionToken,
        failed: false,
      };
      transition(executing);
      onPhaseChangeRef.current(run.request.runToken, 'executing');
      onStatusRef.current('Running');
      executionTimer.current = window.setTimeout(() => {
        executionTimer.current = undefined;
        if (lifecycle.current !== executing) return;
        clearOutputBudget();
        transition({ phase: 'idle' });
        onStatusRef.current('Failed');
        onRestartAfterExecutionRef.current(executing.request);
      }, EXECUTION_TIMEOUT_MS);
      return;
    }

    const progress = preparationLabel(message);
    const phase = lifecycle.current.phase;
    if (progress && phase !== 'executing' && phase !== 'cancelling') {
      onStatusRef.current(progress as PlaygroundSandboxStatus);
    }

    if (message.type === 'done') {
      if (message.compilatonError) {
        if (!bootHandled.current) onStatusRef.current('Failed');
        return;
      }
      if (bootHandled.current) return;
      bootHandled.current = true;
      onStatusRef.current('Preparing runtime');
      let token: number;
      try {
        token = takeSessionToken();
      } catch {
        const run = lifecycle.current;
        if (run.phase === 'queued' || run.phase === 'committing') {
          restartBeforeExecutionRef.current();
        } else {
          onStatusRef.current('Failed');
        }
        return;
      }
      sessionToken.current = token;
      if (!postRuntimeCommand(runtimePrepareCommand(token))) {
        const run = lifecycle.current;
        if (run.phase === 'queued' || run.phase === 'committing') {
          restartBeforeExecutionRef.current();
        } else {
          onStatusRef.current('Failed');
        }
      }
      return;
    }

    if (message.type !== 'console') return;
    const logs = Array.isArray(message.log) ? message.log : [message.log];
    for (const log of logs) {
      const relay = runtimeRelayRecord(log);
      if (relay) handleRelay(relay);
    }
  };

  useEffect(() => {
    onStatusRef.current('Preparing runtime');
  }, []);

  useEffect(
    () => listenRef.current((message) => handleMessageRef.current(message)),
    []
  );

  useEffect(
    () => () => {
      clearAllTimers();
      clearOutputBudget();
    },
    [clearAllTimers, clearOutputBudget]
  );

  useEffect(() => {
    queueEligibleRequest();
  }, [queueEligibleRequest, runLedger]);

  useEffect(() => {
    if (cancelRunToken === null) return;
    const run = lifecycle.current;
    if (
      run.phase === 'idle' ||
      run.request.runToken !== cancelRunToken ||
      run.phase === 'cancelling'
    ) {
      return;
    }
    if (run.phase === 'queued' || run.phase === 'committing') {
      settle(
        run,
        { runToken: cancelRunToken, outcome: 'cancelled' },
        sessionReady.current ? 'Ready' : 'Preparing runtime'
      );
      return;
    }

    postRuntimeCommand(runtimeCancelCommand(run.sessionToken, cancelRunToken));
    const cancelling: RunLifecycle = {
      phase: 'cancelling',
      request: run.request,
      sessionToken: run.sessionToken,
    };
    transition(cancelling);
    cancellationTimer.current = window.setTimeout(() => {
      cancellationTimer.current = undefined;
      if (lifecycle.current !== cancelling) return;
      clearOutputBudget();
      transition({ phase: 'idle' });
      onStatusRef.current('Preparing runtime');
      onCancellationTimeoutRef.current(cancelling.request);
    }, CANCELLATION_TIMEOUT_MS);
  }, [
    cancelRunToken,
    clearOutputBudget,
    postRuntimeCommand,
    settle,
    transition,
  ]);

  return (
    <iframe
      ref={iframe}
      className="playground__runtime-client"
      title="Playground runtime"
      aria-hidden="true"
    />
  );
};

export function PlaygroundSandbox({
  children,
  dependencies,
  initialCode,
  theme,
  sandboxKey,
  runRequest,
  onSettled,
  ...controllerProps
}: PlaygroundSandboxProps): JSX.Element {
  const [controllerGeneration, setControllerGeneration] = useState(0);
  const [runLedger, setRunLedger] = useState<RunLedger | null>(() =>
    runRequest?.sandboxKey === sandboxKey
      ? { request: runRequest, infrastructureRetries: 0 }
      : null
  );
  const runLedgerRef = useRef(runLedger);
  const observedRunRequest = useRef(runRequest);
  const onSettledRef = useRef(onSettled);
  runLedgerRef.current = runLedger;
  onSettledRef.current = onSettled;
  const [{ customSetup, files }] = useState(() => {
    const sandboxInitialCode = isPlaygroundSourceWithinLimit(initialCode)
      ? initialCode
      : PLAYGROUND_SOURCE_TOO_LARGE_PLACEHOLDER;
    const registryDependencies = Object.fromEntries(
      Object.entries(dependencies).filter(([, version]) => version === 'latest')
    );
    const localFiles = Object.fromEntries(
      favyDiSourceFiles.map(({ sandboxPath, code }) => [
        sandboxPath,
        { code, hidden: true },
      ])
    );
    return {
      customSetup: {
        entry: '/runner.ts',
        dependencies: registryDependencies,
      },
      files: {
        ...localFiles,
        '/index.ts': { code: sandboxInitialCode, active: true },
        '/execution.ts': { code: '', hidden: true },
        '/runner.ts': { code: runtimeSource(), hidden: true },
        '/warmup.ts': {
          code: warmupSource(Object.keys(dependencies)),
          hidden: true,
        },
        '/runtime-worker.ts': { code: workerSource(), hidden: true },
        '/vite.config.js': { code: VITE_CONFIG_SOURCE, hidden: true },
        '/index.html': {
          code: '<!doctype html><script type="module" src="/runner.ts"></script>',
          hidden: true,
        },
      },
    };
  });

  useEffect(() => {
    if (observedRunRequest.current === runRequest) return;
    observedRunRequest.current = runRequest;
    if (
      !runRequest ||
      runRequest.sandboxKey !== sandboxKey ||
      runLedgerRef.current
    ) {
      return;
    }
    const nextLedger: RunLedger = {
      request: runRequest,
      infrastructureRetries: 0,
    };
    runLedgerRef.current = nextLedger;
    setRunLedger(nextLedger);
  }, [runRequest, sandboxKey]);

  const settleRun = useCallback(
    (
      request: PlaygroundRunRequest,
      settlement: PlaygroundRunSettlement,
      restartController: boolean
    ): void => {
      if (
        runLedgerRef.current?.request !== request ||
        settlement.runToken !== request.runToken
      ) {
        return;
      }
      runLedgerRef.current = null;
      setRunLedger(null);
      if (restartController) {
        setControllerGeneration((generation) => generation + 1);
      }
      onSettledRef.current(settlement);
    },
    []
  );

  const handleRestartBeforeExecution = useCallback(
    (nextLedger: RunLedger): void => {
      const current = runLedgerRef.current;
      if (
        !current ||
        current.request !== nextLedger.request ||
        current.infrastructureRetries !== 0 ||
        nextLedger.infrastructureRetries !== 1
      ) {
        return;
      }
      runLedgerRef.current = nextLedger;
      setRunLedger(nextLedger);
      setControllerGeneration((generation) => generation + 1);
    },
    []
  );

  const handleRestartAfterExecution = useCallback(
    (request: PlaygroundRunRequest): void => {
      settleRun(
        request,
        { runToken: request.runToken, outcome: 'runtime-restarted' },
        true
      );
    },
    [settleRun]
  );

  const handleCancellationTimeout = useCallback(
    (request: PlaygroundRunRequest): void => {
      settleRun(
        request,
        { runToken: request.runToken, outcome: 'cancelled' },
        true
      );
    },
    [settleRun]
  );

  const handleControllerSettled = useCallback(
    (
      request: PlaygroundRunRequest,
      settlement: PlaygroundRunSettlement
    ): void => settleRun(request, settlement, false),
    [settleRun]
  );

  return (
    <SandpackProvider
      template="vite"
      files={files}
      customSetup={customSetup}
      options={SANDBOX_OPTIONS}
      theme={theme}
    >
      <SandboxController
        key={controllerGeneration}
        sandboxKey={sandboxKey}
        runLedger={runLedger}
        onRestartBeforeExecution={handleRestartBeforeExecution}
        onRestartAfterExecution={handleRestartAfterExecution}
        onCancellationTimeout={handleCancellationTimeout}
        onControllerSettled={handleControllerSettled}
        {...controllerProps}
      />
      {children}
    </SandpackProvider>
  );
}
