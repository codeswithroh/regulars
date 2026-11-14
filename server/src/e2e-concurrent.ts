// Live check: several customers pay at once and their issue requests race for the single supply
// output. Every payment must be rewarded exactly once. Usage: npm run e2e:concurrent -w server
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { generatePrivateKey, secp256k1, hash160, encodeCashAddress } from '@bitauth/libauth';
import { sweep } from './issue.js';
import { merchantWallet, need, prefix, withConnection } from './config.js';

const CUSTOMERS = 4;
const PAYMENT = 3_000n;
const merchant = merchantWallet();
const category = need('STAMP_CATEGORY');
const expected = PAYMENT / BigInt(need('SATS_PER_STAMP_EARNED'));

const customers = Array.from({ length: CUSTOMERS }, () => {
  const priv = generatePrivateKey();
  const address = encodeCashAddress({ prefix, type: 'p2pkh', payload: hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array), throwErrors: true }).address;
  return { address, signer: new SignatureTemplate(priv), txid: '' };
});

await withConnection(async (provider) => {
  const coin = (await provider.getUtxos(merchant.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  const seed = PAYMENT + 1000n;
  const funding = new TransactionBuilder({ provider }).addInput(coin, merchant.signer.unlockP2PKH());
  customers.forEach((c) => funding.addOutput({ to: c.address, amount: seed }));
  await funding.addOutput({ to: merchant.address, amount: coin.satoshis - seed * BigInt(CUSTOMERS) - 500n }).send();
  for (const c of customers) {
    const [utxo] = await provider.getUtxos(c.address);
    c.txid = (await new TransactionBuilder({ provider }).addInput(utxo, c.signer.unlockP2PKH())
      .addOutput({ to: merchant.address, amount: PAYMENT }).addOutput({ to: c.address, amount: utxo.satoshis - PAYMENT - 300n }).send()).txid;
  }
});
console.log(`${CUSTOMERS} customers paid ${PAYMENT} sats each`);

// Each customer keeps asking, as the web app does, until their own payment is rewarded.
const started = Date.now();
let collisions = 0;
const issuedPerCustomer = await Promise.all(customers.map(async (c) => {
  let count = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const issued = await sweep({ txid: c.txid }).catch(() => { collisions++; return []; });
    count += issued.length;
    const stamps = await withConnection(async (p) => (await p.getUtxos(c.address)).filter((u) => u.token?.category === category).reduce((s, u) => s + u.token!.amount, 0n));
    if (stamps > 0n) return { count, stamps };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { count, stamps: 0n };
}));
console.log(`all settled in ${((Date.now() - started) / 1000).toFixed(1)}s with ${collisions} lost races retried`);
issuedPerCustomer.forEach((r, i) => console.log(`  customer ${i + 1}: ${r.stamps} stamps`));
if (issuedPerCustomer.some((r) => r.stamps !== expected)) throw new Error(`Expected every customer to hold exactly ${expected} stamps`);
// Nothing left to reward, so a full sweep must issue nothing.
if ((await sweep()).length !== 0) throw new Error('A payment was rewarded twice or left unrewarded');
console.log('exactly-once issuing held under concurrency');
process.exit(0);
