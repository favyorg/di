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
  type PropsWithChildren,
} from 'react';
import { favyDiSourceFiles } from './favy-di-sources';
import type { PlaygroundDependencies } from './playground-dependencies';
import {
  frameHtmlSource,
  preparationLabel,
  runtimePrepareCommand,
  runtimeRelayRecord,
  runtimeRunCommand,
  runtimeSource,
  setupForRun,
  warmupSource,
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

type ActiveRun = {
  request: PlaygroundRunRequest;
  phase: PlaygroundRunPhase;
  expectedContent?: string;
  failed: boolean;
};

type SandboxControllerProps = Pick<
  PlaygroundSandboxProps,
  | 'sandboxKey'
  | 'runRequest'
  | 'cancelRunToken'
  | 'onReady'
  | 'onPhaseChange'
  | 'onOutput'
  | 'onSettled'
  | 'onStatus'
>;

const SANDBOX_OPTIONS = Object.freeze({
  activeFile: '/index.ts',
  autorun: true,
  autoReload: false,
});

const VITE_CONFIG_SOURCE =
  "export default { resolve: { alias: [{ find: /^@favy\\/di$/, replacement: '/favy-di/index.ts' }] }, server: { cors: { origin: '*' }, hmr: false } };";

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
  runRequest,
  cancelRunToken,
  onReady,
  onPhaseChange,
  onOutput,
  onSettled,
  onStatus,
}: SandboxControllerProps): JSX.Element => {
  const { iframe, getClient, listen } = useSandpackClient();
  const bootHandled = useRef(false);
  const sessionToken = useRef<number>();
  const sessionReady = useRef(false);
  const activeRun = useRef<ActiveRun>();
  const runRequestRef = useRef(runRequest);
  const sandboxKeyRef = useRef(sandboxKey);
  const listenRef = useRef(listen);
  const getClientRef = useRef(getClient);
  const onReadyRef = useRef(onReady);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const onOutputRef = useRef(onOutput);
  const onSettledRef = useRef(onSettled);
  const onStatusRef = useRef(onStatus);
  const tryCommitRef = useRef<() => boolean>(() => false);
  const handleMessageRef = useRef<(message: SandpackMessage) => void>(
    () => undefined
  );
  runRequestRef.current = runRequest;
  sandboxKeyRef.current = sandboxKey;
  listenRef.current = listen;
  getClientRef.current = getClient;
  onReadyRef.current = onReady;
  onPhaseChangeRef.current = onPhaseChange;
  onOutputRef.current = onOutput;
  onSettledRef.current = onSettled;
  onStatusRef.current = onStatus;

  const postRuntimeCommand = useCallback(
    (command: ReturnType<typeof runtimePrepareCommand>): boolean => {
      const runtime = iframe.current;
      if (!runtime?.contentWindow) return false;
      runtime.contentWindow.postMessage(command, runtimeTargetOrigin(runtime));
      return true;
    },
    [iframe]
  );

  const settleUnavailable = useCallback((run: ActiveRun): void => {
    if (activeRun.current !== run) return;
    activeRun.current = undefined;
    onStatusRef.current('Failed');
    onSettledRef.current({
      runToken: run.request.runToken,
      outcome: 'runtime-unavailable',
    });
  }, []);

  const tryCommit = useCallback((): boolean => {
    const run = activeRun.current;
    if (!run || run.phase !== 'queued' || !sessionReady.current) return false;
    const currentSessionToken = sessionToken.current;
    if (currentSessionToken === undefined) return false;
    const client = getClientRef.current();
    if (!client) {
      onStatusRef.current('Preparing runtime');
      return true;
    }

    try {
      const nextSetup = setupForRun(
        client.sandboxSetup,
        run.request.code,
        currentSessionToken,
        run.request.runToken
      );
      const expectedContent = nextSetup.files['/execution.ts'].code;
      run.phase = 'committing';
      run.expectedContent = expectedContent;
      onOutputRef.current({ type: 'reset', runToken: run.request.runToken });
      onPhaseChangeRef.current(run.request.runToken, 'committing');
      client.updateSandbox(nextSetup);
    } catch {
      settleUnavailable(run);
    }
    return true;
  }, [settleUnavailable]);
  tryCommitRef.current = tryCommit;

  const queueEligibleRequest = useCallback((): void => {
    const request = runRequestRef.current;
    if (
      !request ||
      request.sandboxKey !== sandboxKeyRef.current ||
      activeRun.current
    ) {
      return;
    }
    activeRun.current = {
      request,
      phase: 'queued',
      failed: false,
    };
    onPhaseChangeRef.current(request.runToken, 'queued');
    if (!tryCommitRef.current()) onStatusRef.current('Preparing runtime');
  }, []);

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
        onReadyRef.current(sandboxKeyRef.current);
        queueEligibleRequest();
        if (!tryCommitRef.current() && !activeRun.current) {
          onStatusRef.current('Ready');
        }
        return;
      }

      if (relay.kind === 'prepareError') {
        const run = activeRun.current;
        if (run) settleUnavailable(run);
        else onStatusRef.current('Failed');
        return;
      }

      const run = activeRun.current;
      if (
        !run ||
        run.phase !== 'executing' ||
        relay.runToken !== run.request.runToken
      ) {
        return;
      }

      if (relay.kind === 'output') {
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

      activeRun.current = undefined;
      if (relay.kind === 'cancelled') {
        onStatusRef.current('Ready');
        onSettledRef.current({
          runToken: run.request.runToken,
          outcome: 'cancelled',
        });
        return;
      }
      onStatusRef.current(run.failed ? 'Failed' : 'Ready');
      onSettledRef.current({
        runToken: run.request.runToken,
        outcome: 'completed',
        failed: run.failed,
      });
    },
    [queueEligibleRequest, settleUnavailable]
  );

  handleMessageRef.current = (message): void => {
    if (message.type === 'fs/change') {
      const run = activeRun.current;
      if (
        !run ||
        run.phase !== 'committing' ||
        message.path !== '/execution.ts' ||
        message.content !== run.expectedContent
      ) {
        return;
      }
      const currentSessionToken = sessionToken.current;
      if (currentSessionToken === undefined) return;
      run.phase = 'executing';
      run.expectedContent = undefined;
      if (
        !postRuntimeCommand(
          runtimeRunCommand(currentSessionToken, run.request.runToken)
        )
      ) {
        settleUnavailable(run);
        return;
      }
      onPhaseChangeRef.current(run.request.runToken, 'executing');
      onStatusRef.current('Running');
      return;
    }

    const progress = preparationLabel(message);
    if (progress && activeRun.current?.phase !== 'executing') {
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
        const run = activeRun.current;
        if (run) settleUnavailable(run);
        else onStatusRef.current('Failed');
        return;
      }
      sessionToken.current = token;
      if (!postRuntimeCommand(runtimePrepareCommand(token))) {
        const run = activeRun.current;
        if (run) settleUnavailable(run);
        else onStatusRef.current('Failed');
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

  useEffect(() => {
    queueEligibleRequest();
  }, [queueEligibleRequest, runRequest]);

  useEffect(() => {
    if (cancelRunToken === null) return;
    const run = activeRun.current;
    if (
      !run ||
      run.request.runToken !== cancelRunToken ||
      run.phase === 'executing'
    ) {
      return;
    }
    activeRun.current = undefined;
    onSettledRef.current({ runToken: cancelRunToken, outcome: 'cancelled' });
    onStatusRef.current(sessionReady.current ? 'Ready' : 'Preparing runtime');
  }, [cancelRunToken]);

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
  ...controllerProps
}: PlaygroundSandboxProps): JSX.Element {
  const [controllerGeneration] = useState(0);
  const [{ customSetup, files }] = useState(() => {
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
        '/index.ts': { code: initialCode, active: true },
        '/execution.ts': { code: '', hidden: true },
        '/runner.ts': { code: runtimeSource(), hidden: true },
        '/warmup.ts': {
          code: warmupSource(Object.keys(dependencies)),
          hidden: true,
        },
        '/frame.html': { code: frameHtmlSource(), hidden: true },
        '/vite.config.js': { code: VITE_CONFIG_SOURCE, hidden: true },
        '/index.html': {
          code: '<!doctype html><script type="module" src="/runner.ts"></script>',
          hidden: true,
        },
      },
    };
  });

  return (
    <SandpackProvider
      template="vite"
      files={files}
      customSetup={customSetup}
      options={SANDBOX_OPTIONS}
      theme={theme}
    >
      <SandboxController key={controllerGeneration} {...controllerProps} />
      {children}
    </SandpackProvider>
  );
}
