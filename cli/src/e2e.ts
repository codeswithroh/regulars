// Live check with throwaway customer keys against the demo shop: several customers pay at once
// (each payment delivers its stamps in the same transaction), then one redeems.
// Usage: npm run e2e -w cli        E2E_PAYMENT and E2E_CUSTOMERS adjust the spend.
import { TransactionBuilder } from 'cashscript';
import { generatePrivateKey } from '@bitauth/libauth';
import { buildEarn, buildRedeem, makeIssuer, makeReserve } from '@regulars/contracts';
import { demoShop, ownerWallet, protocol, walletFrom, withConnection } from './config.js';

const PAYMENT = BigInt(process.env.E2E_PAYMENT ?? 5_000);
const CUSTOMERS = Number(process.env.E2E_CUSTOMERS ?? 3);
const shop = demoShop();
const owner = ownerWallet();
const customers = Array.from({ length: CUSTOMERS }, () => walletFrom(generatePrivateKey()));

await withConnection(async (provider) => {
  const issuer = makeIssuer(shop, protocol(), provider);
  const reserve = makeReserve(shop, provider);
  const stampsOf = async (address: string) => (await provider.getUtxos(address)).filter((u) => u.token?.category === shop.category);

  // Fund the throwaway customers from the owner's plain coins.
  const coin = (await provider.getUtxos(owner.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  const seed = PAYMENT + 2500n;
  const funding = new TransactionBuilder({ provider }).addInput(coin, owner.signer.unlockP2PKH());
  customers.forEach((c) => funding.addOutput({ to: c.address, amount: seed }));
  await funding.addOutput({ to: owner.address, amount: coin.satoshis - seed * BigInt(CUSTOMERS) - 600n }).send();
  console.log(`1. funded ${CUSTOMERS} customers`);

  // Everyone pays at once. Each picks a random issuer output and retries if someone else took it.
  const started = Date.now();
  let retries = 0;
  await Promise.all(customers.map(async (c) => {
    for (let attempt = 0; ; attempt++) {
      const issuers = await issuer.getUtxos();
      const issuerUtxo = issuers[Math.floor(Math.random() * issuers.length)];
      const coins = (await provider.getUtxos(c.address)).filter((u) => !u.token).map((utxo) => ({ utxo, unlocker: c.signer.unlockP2PKH() }));
      try {
        await buildEarn({ shop, protocol: protocol(), issuerUtxo, coins, pay: PAYMENT, customerAddress: c.address, customerTokenAddress: c.tokenAddress, provider }).builder.send();
        return;
      } catch (error) {
        if (attempt >= 8) throw error;
        retries++;
      }
    }
  }));
  const expected = PAYMENT / shop.earn;
  for (const c of customers) {
    const held = (await stampsOf(c.address)).reduce((s, u) => s + u.token!.amount, 0n);
    if (held !== expected) throw new Error(`A customer holds ${held} stamps, expected ${expected}`);
  }
  console.log(`2. ${CUSTOMERS} customers paid ${PAYMENT} sats and each got ${expected} stamps in the same transaction (${((Date.now() - started) / 1000).toFixed(1)}s, ${retries} retries)`);

  // One customer redeems.
  const c = customers[0];
  const before = await reserve.getUtxos();
  const reserveUtxo = [...before].sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  const stampInputs = (await stampsOf(c.address)).map((utxo) => ({ utxo, unlocker: c.signer.unlockP2PKH() }));
  const { builder, plan } = buildRedeem({ shop, reserveUtxo, stampInputs, stamps: expected, customerAddress: c.address, customerTokenAddress: c.tokenAddress, provider });
  const redeemed = await builder.send();
  const after = await reserve.getUtxos();
  const sum = (u: typeof after) => u.reduce((s, x) => s + x.satoshis, 0n);
  if (sum(before) - sum(after) !== plan.reward) throw new Error('Reserve did not fall by exactly the reward');
  console.log(`3. redeemed ${plan.stamps} stamps: reserve released ${plan.reward} sats, customer received ${plan.payout} (${redeemed.txid})`);
});
process.exit(0);
