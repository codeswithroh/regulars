// Optional always-on loop for merchants who run their own box: rewards payments made from any
// wallet, not just the web app. The deployed site does the same work on demand via /api/issue.
import { merchantWallet, network } from './config.js';
import { sweep } from './issue.js';

const pollMs = Number((process.env.POLL_SECONDS ?? '4').split('#')[0]) * 1000;
console.log(`Regulars issuer on ${network}. Watching ${merchantWallet().address}`);
for (;;) {
  try {
    for (const i of await sweep()) console.log(`${i.paidSats} sats in ${i.paymentTxid.slice(0, 12)}… → ${i.stamps} stamp(s) to ${i.to} (${i.txid})`);
  } catch (error) {
    console.error('Issuer error:', error instanceof Error ? error.message : error);
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
