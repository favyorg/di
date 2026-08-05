import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const smokeModule = new URL('./docs-pages-smoke.mjs', import.meta.url);

if (process.env.DOCS_URL) {
  await import(smokeModule.href);
} else {
  const host = '127.0.0.1';
  const configuredPort = process.env.DOCS_SMOKE_PORT ?? '4399';
  const portNumber = Number(configuredPort);
  if (
    !/^\d+$/.test(configuredPort) ||
    !Number.isInteger(portNumber) ||
    portNumber < 1 ||
    portNumber > 65_535
  ) {
    throw new RangeError(
      'DOCS_SMOKE_PORT must be an integer from 1 through 65535.'
    );
  }
  const port = String(portNumber);
  const origin = `http://${host}:${port}`;
  const docsRoot = fileURLToPath(new URL('../', import.meta.url));
  const astroCli = fileURLToPath(
    new URL('../node_modules/astro/astro.js', import.meta.url)
  );

  await new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.unref();
    reservation.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Smoke preview port ${port} is already in use before Astro preview startup.`
            )
          : error
      );
    });
    reservation.listen({ host, port: portNumber, exclusive: true }, () => {
      reservation.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const preview = spawn(
    process.execPath,
    [astroCli, 'preview', '--host', host, '--port', port],
    {
      cwd: docsRoot,
      env: process.env,
      stdio: 'inherit',
    }
  );

  let previewExited = false;
  const previewExit = new Promise((resolve) => {
    preview.once('error', (error) => {
      previewExited = true;
      resolve({ error });
    });
    preview.once('exit', (code, signal) => {
      previewExited = true;
      resolve({ code, signal });
    });
  });
  const delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  const waitForPreview = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await delay(Math.min(100, Math.max(0, deadline - Date.now())));
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(Math.min(1_000, remaining)),
        });
        if (response.ok) return;
      } catch {}
    }
    throw new Error(`Astro preview did not become ready at ${origin} in 30s.`);
  };

  const failOnEarlyExit = previewExit.then((result) => {
    if ('error' in result) throw result.error;
    throw new Error(
      `Astro preview exited before readiness (code ${String(
        result.code
      )}, signal ${String(result.signal)}).`
    );
  });

  const waitForExit = async (milliseconds) => {
    let timeout;
    try {
      return await Promise.race([
        previewExit.then(() => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };

  let stopPromise;
  const stopPreview = () => {
    stopPromise ??= (async () => {
      if (previewExited) return;
      preview.kill('SIGTERM');
      const exitedAfterTerm = await waitForExit(2_000);
      if (!exitedAfterTerm && !previewExited) {
        preview.kill('SIGKILL');
        await waitForExit(2_000);
      }
    })();
    return stopPromise;
  };
  let exitingForSignal = false;
  const handleSignal = (exitCode) => {
    if (exitingForSignal) return;
    exitingForSignal = true;
    void stopPreview().finally(() => process.exit(exitCode));
  };
  const handleSigint = () => handleSignal(130);
  const handleSigterm = () => handleSignal(143);
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  try {
    await Promise.race([waitForPreview(), failOnEarlyExit]);
    process.env.DOCS_URL = origin;
    await import(smokeModule.href);
  } finally {
    await stopPreview();
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  }
}
