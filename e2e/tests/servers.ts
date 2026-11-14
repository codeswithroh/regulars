// Starts the dev API and the Vite dev server for the test run, and stops them afterwards.
// Set E2E_BASE_URL to test an already-running site (e.g. the Vercel deployment) instead.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WEB_PORT = 5183;
const API_PORT = 8797;
const root = fileURLToPath(new URL('../..', import.meta.url));

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${url} did not start`);
}

export default async function setup() {
  if (process.env.E2E_BASE_URL) return;
  const env = { ...process.env, API_PORT: String(API_PORT) };
  const start = (args: string[]) => spawn('npm', args, { cwd: root, env, stdio: 'ignore', detached: true });
  // ENV_FILE=.env.mainnet runs the whole stack against mainnet.
  const mode = (process.env.ENV_FILE ?? '').replace(/^\.env\.?/, '');
  const children: ChildProcess[] = [
    start(['run', 'api', '-w', 'server']),
    start(['run', 'dev', '-w', 'web', '--', '--port', String(WEB_PORT), '--strictPort', ...(mode ? ['--mode', mode] : [])]),
  ];
  await Promise.all([waitFor(`http://localhost:${API_PORT}/`), waitFor(`http://localhost:${WEB_PORT}/`)]);
  return () => children.forEach((child) => child.pid && process.kill(-child.pid));
}
