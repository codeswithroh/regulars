import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { regularsTemplate } from './template.js';

const out = fileURLToPath(new URL('../regulars.template.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(regularsTemplate, (_k, value) => (typeof value === 'bigint' ? `<bigint: ${value}n>` : value), 2)}\n`);
console.log(`Wrote ${out}`);
