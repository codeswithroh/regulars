// Stamp issuing with no database. An unrewarded payment is simply an unspent output at the
// merchant address; issuing stamps spends that output, so a payment can never be rewarded twice
// and any number of callers (web app, cron, a loop) can trigger issuing safely.
import { TransactionBuilder, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { TOKEN_DUST } from '@regulars/contracts';
import { merchantWallet, need, prefix, withConnection } from './config.js';
import { readPayment, stampsEarned } from './payments.js';

export interface Issued {
  paymentTxid: string;
  paidSats: string;
  stamps: string;
  to: string;
  txid: string;
}

/** Most payments handled per call, to keep a serverless invocation short. */
const MAX_PER_CALL = 5;

export const isSupply = (u: SpendableUtxo, category: string) => u.token?.category === category && !u.token.nft;

/**
 * A supply UTXO holds unissued stamps and doubles as the fee tank and till: each issuance
 * spends it together with the payment and recreates it with the payment's BCH added.
 */
async function issue(
  provider: NetworkProvider,
  merchant: ReturnType<typeof merchantWallet>,
  category: string,
  supply: SpendableUtxo,
  paymentUtxos: SpendableUtxo[],
  payerTokenAddress: string,
  stamps: bigint,
) {
  const supplyLeft = supply.token!.amount - stamps;
  if (supplyLeft < 0n) throw new Error(`Stamp supply (${supply.token!.amount}) is below the ${stamps} owed`);
  const sats = supply.satoshis + paymentUtxos.reduce((sum, u) => sum + u.satoshis, 0n);

  const assemble = (fee: bigint) => {
    const back = sats - TOKEN_DUST - fee;
    if (back < TOKEN_DUST) throw new Error('Supply UTXO is out of BCH for fees; run: setup fuel <sats>');
    const builder = new TransactionBuilder({ provider })
      .addInput(supply, merchant.signer.unlockP2PKH())
      .addInputs(paymentUtxos, merchant.signer.unlockP2PKH())
      .addOutput({ to: payerTokenAddress, amount: TOKEN_DUST, token: { category, amount: stamps } });
    // Keep the token output alive even when the last stamp is issued.
    return supplyLeft > 0n
      ? builder.addOutput({ to: merchant.tokenAddress, amount: back, token: { category, amount: supplyLeft } })
      : builder.addOutput({ to: merchant.address, amount: back });
  };
  const size = BigInt(assemble(600n).build().length / 2);
  return assemble(size + 10n).send();
}

/** Reward unrewarded payments. With `txid`, only that payment is considered. */
export const sweep = (options: { txid?: string } = {}): Promise<Issued[]> =>
  withConnection((provider) => sweepWith(provider, options));

async function sweepWith(provider: NetworkProvider, options: { txid?: string }): Promise<Issued[]> {
  const merchant = merchantWallet();
  const category = need('STAMP_CATEGORY');
  const rate = BigInt(need('SATS_PER_STAMP_EARNED'));

  const candidates = (await provider.getUtxos(merchant.address)).filter((u) => !u.token);
  const txids = [...new Set(candidates.map((u) => u.txid))].filter((txid) => !options.txid || txid === options.txid);

  const issued: Issued[] = [];
  for (const txid of txids) {
    if (issued.length >= MAX_PER_CALL) break;
    const payment = readPayment(await provider.getRawTransaction(txid), txid, merchant.pkh, prefix);
    if (!payment) continue; // the merchant's own coins
    const stamps = stampsEarned(payment.paidSats, rate);
    if (stamps === 0n) continue; // too small to earn a stamp

    // Re-read so each issuance spends the supply output created by the previous one.
    const utxos = await provider.getUtxos(merchant.address);
    const paymentUtxos = utxos.filter((u) => u.txid === txid && !u.token);
    if (paymentUtxos.length === 0) continue; // another caller rewarded it first
    // The supply is split over several outputs; picking one at random keeps simultaneous
    // requests from all contending for the same output.
    const supplies = utxos.filter((u) => isSupply(u, category) && u.token!.amount >= stamps);
    const supply = supplies[Math.floor(Math.random() * supplies.length)];
    if (!supply) throw new Error('No stamp supply at the merchant address; run: setup mint');

    const sent = await issue(provider, merchant, category, supply, paymentUtxos, payment.payerTokenAddress, stamps);
    issued.push({
      paymentTxid: txid,
      paidSats: String(payment.paidSats),
      stamps: String(stamps),
      to: payment.payerTokenAddress,
      txid: sent.txid,
    });
  }
  return issued;
}
