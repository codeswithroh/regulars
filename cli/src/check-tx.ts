// Prints whether each txid is known to the configured network. Usage: npm run check-tx -w cli -- <txid>...
import { withConnection } from './config.js';
await withConnection(async (provider) => {
  for (const txid of process.argv.slice(2)) {
    const raw = await provider.getRawTransaction(txid).catch(() => '');
    console.log(`${txid}  ${raw ? `${raw.length / 2} bytes, on chain` : 'NOT FOUND'}`);
  }
});
process.exit(0);
