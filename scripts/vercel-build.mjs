// Builds .vercel/output (Vercel Build Output API v3): a static site and nothing else.
// Deploy with: npm run deploy
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;

rmSync(out, { recursive: true, force: true });
// ENV_FILE=.env.mainnet builds the mainnet site: Vite mode "mainnet" layers .env.mainnet over .env.
const mode = (process.env.ENV_FILE ?? '').replace(/^\.env\.?/, '');
execSync('npm run compile', { cwd: root, stdio: 'inherit' });
execSync(`npm run build -w web${mode ? ` -- --mode ${mode}` : ''}`, { cwd: root, stdio: 'inherit' });
mkdirSync(out, { recursive: true });
cpSync(`${root}web/dist`, `${out}/static`, { recursive: true });

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [{ handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }],
}, null, 2));
console.log('Built .vercel/output');
