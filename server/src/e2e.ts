// Live check with a throwaway customer key: pay the merchant, wait for stamps, redeem them.
// Usage: npm run e2e -w server
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { generatePrivateKey, secp256k1, hash160, encodeCashAddress } from '@bitauth/libauth';
import { buildRedeem } from '@regulars/contracts';
import { sweep } from './issue.js';
import { merchantWallet, need, prefix, provider as makeProvider, reserveFor, reserveParams } from './config.js';

const provider = makeProvider();
const merchant = merchantWallet();
const params = reserveParams(merchant.pkhHex);
const reserve = reserveFor(merchant.pkhHex, provider);
const satsPerStampEarned = BigInt(need('SATS_PER_STAMP_EARNED'));
const PAYMENT = BigInt(process.env.E2E_PAYMENT ?? 20_000);

const priv = generatePrivateKey();
const pkh = hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
const address = (type: 'p2pkh' | 'p2pkhWithTokens') => encodeCashAddress({ prefix, type, payload: pkh, throwErrors: true }).address;
const customer = { address: address('p2pkh'), tokenAddress: address('p2pkhWithTokens'), signer: new SignatureTemplate(priv) };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Give the throwaway customer some BCH (a merchant-origin transaction, so the issuer ignores it).
const coins = (await provider.getUtxos(merchant.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
const seed = PAYMENT + 2000n;
const funding = await new TransactionBuilder({ provider })
  .addInput(coins[0], merchant.signer.unlockP2PKH())
  .addOutput({ to: customer.address, amount: seed })
  .addOutput({ to: merchant.address, amount: coins[0].satoshis - seed - 300n })
  .send();
console.log(`1. customer ${customer.address} funded (${funding.txid})`);

// 2. Customer pays the merchant.
await sleep(1500);
const [coin] = await provider.getUtxos(customer.address);
const payment = await new TransactionBuilder({ provider })
  .addInput(coin, customer.signer.unlockP2PKH())
  .addOutput({ to: merchant.address, amount: PAYMENT })
  .addOutput({ to: customer.address, amount: coin.satoshis - PAYMENT - 300n })
  .send();
console.log(`2. paid ${PAYMENT} sats (${payment.txid})`);

// 3. Trigger issuing for that payment, as the web app does, until the payment is visible.
const expected = PAYMENT / satsPerStampEarned;
const started = Date.now();
let stampUtxo;
while (!stampUtxo && Date.now() - started < 60_000) {
  await sweep({ txid: payment.txid }).catch(() => []);
  stampUtxo = (await provider.getUtxos(customer.address)).find((u) => u.token?.category === params.stampCategory);
  if (!stampUtxo) await sleep(1000);
}
if (!stampUtxo) throw new Error('No stamps arrived within 60s');
console.log(`3. received ${stampUtxo.token!.amount} stamps after ${((Date.now() - started) / 1000).toFixed(1)}s (expected ${expected})`);
if (stampUtxo.token!.amount !== expected) throw new Error('Wrong stamp count');
if ((await sweep({ txid: payment.txid })).length !== 0) throw new Error('Payment was rewarded twice');
console.log('   second issue call for the same payment issued nothing');

// 4. Redeem them against the reserve covenant.
const before = await reserve.getUtxos();
const reserveUtxo = [...before].sort((a, b) => Number(b.satoshis - a.satoshis))[0];
const { builder, plan } = buildRedeem({
  reserve, params, reserveUtxo, provider,
  stampInputs: [{ utxo: stampUtxo, unlocker: customer.signer.unlockP2PKH() }],
  stamps: stampUtxo.token!.amount,
  customerAddress: customer.address,
  customerTokenAddress: customer.tokenAddress,
});
const redeemed = await builder.send();
console.log(`4. redeemed ${plan.stamps} stamps for ${plan.payout} sats, fee ${plan.fee} (${redeemed.txid})`);

await sleep(1500);
const after = await reserve.getUtxos();
const total = (utxos: typeof after) => utxos.reduce((s, u) => s + u.satoshis, 0n);
console.log(`5. reserve ${total(before)} → ${total(after)} sats, holding ${after.reduce((s, u) => s + (u.token?.amount ?? 0n), 0n)} stamps`);
process.exit(0);
