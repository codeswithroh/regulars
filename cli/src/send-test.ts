// Send chipnet test coins from the owner key to an address. Usage: npm run send-test -w cli -- <address> <sats>
import { TransactionBuilder } from 'cashscript';
import { network, ownerWallet, withConnection } from './config.js';
const [to, satsArg] = process.argv.slice(2);
if (network !== 'chipnet') throw new Error('send-test only runs on chipnet');
if (!to?.startsWith('bchtest:') || !/^\d+$/.test(satsArg ?? '')) throw new Error('Usage: send-test <bchtest:address> <sats>');
const amount = BigInt(satsArg);
await withConnection(async (provider) => {
  const owner = ownerWallet();
  const coins = (await provider.getUtxos(owner.address)).filter((u) => !u.token);
  const total = coins.reduce((s, u) => s + u.satoshis, 0n);
  const fee = BigInt(coins.length) * 150n + 300n;
  const sent = await new TransactionBuilder({ provider }).addInputs(coins, owner.signer.unlockP2PKH())
    .addOutput({ to, amount }).addOutput({ to: owner.address, amount: total - amount - fee }).send();
  console.log(`Sent ${amount} sats to ${to} (${sent.txid})`);
});
process.exit(0);
