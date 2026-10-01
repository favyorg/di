import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Every suite can run independently, on CI or against an existing preview.
export async function startBrowserSession() {
  let browser;
  let preview;
  async function startPreview() {
    await access(new URL('../dist/index.html', import.meta.url)).catch(() => {
      throw new Error('Build the docs first: cd docs && npm run build');
    });
    preview = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('../node_modules/astro/astro.js', import.meta.url)
        ),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '0',
      ],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    let timeout;
    try {
      const origin = await new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Astro preview did not start within 30 seconds:\n${output}`
            )
          );
        }, 30_000);
        const readOutput = (chunk) => {
          output = (output + chunk).slice(-8000);
          const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
          if (url) resolve(url);
        };
        preview.stdout.on('data', readOutput);
        preview.stderr.on('data', readOutput);
        preview.once('error', reject);
        preview.once('exit', (code) => {
          reject(new Error(`Astro preview exited (${code}):\n${output}`));
        });
      });
      const response = await fetch(`${origin}/guides/introduction/`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`Astro preview returned HTTP ${response.status}`);
      await response.body.cancel();
      console.log(`Documentation regression preview: ${origin}`);
      return origin;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function stopPreview() {
    if (
      !preview?.pid ||
      preview.exitCode !== null ||
      preview.signalCode !== null
    )
      return;
    const closed = once(preview, 'exit');
    const timeout = setTimeout(() => preview.kill('SIGKILL'), 5000);
    try {
      preview.kill('SIGTERM');
      await closed;
    } finally {
      clearTimeout(timeout);
    }
  }

  const terminatePreview = () => preview?.kill('SIGTERM');
  const onInterrupt = () => {
    terminatePreview();
    process.exit(130);
  };
  const onTerminate = () => {
    terminatePreview();
    process.exit(143);
  };
  process.once('exit', terminatePreview);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  const close = async () => {
    try {
      await browser?.close();
    } finally {
      try {
        await stopPreview();
      } finally {
        process.removeListener('exit', terminatePreview);
        process.removeListener('SIGINT', onInterrupt);
        process.removeListener('SIGTERM', onTerminate);
      }
    }
  };

  try {
    const origin =
      process.env.DOCS_URL?.replace(/\/$/, '') || (await startPreview());
    browser = await chromium.launch(
      process.env.PLAYWRIGHT_CHANNEL
        ? { channel: process.env.PLAYWRIGHT_CHANNEL }
        : {}
    );
    return { browser, origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}
