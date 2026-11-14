// Builds .vercel/output (Vercel Build Output API v3): the static web app plus one Node function
// for POST /api/issue. Deploy with: npm run deploy
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api/issue.func`;

rmSync(out, { recursive: true, force: true });
// ENV_FILE=.env.mainnet builds the mainnet site: Vite mode "mainnet" layers .env.mainnet over .env.
const mode = (process.env.ENV_FILE ?? '').replace(/^\.env\.?/, '');
execSync('npm run compile', { cwd: root, stdio: 'inherit' });
execSync(`npm run build -w web${mode ? ` -- --mode ${mode}` : ''}`, { cwd: root, stdio: 'inherit' });
cpSync(`${root}web/dist`, `${out}/static`, { recursive: true });

mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [`${root}server/src/handler.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Some dependencies are CommonJS and call require() at runtime.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30,
}, null, 2));
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [{ handle: 'filesystem' }, { src: '/(?!api/).*', dest: '/index.html' }],
}, null, 2));
console.log('Built .vercel/output');
