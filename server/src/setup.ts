// One-off merchant commands:  npm run setup -w server -- <keygen|status|mint|split|fuel|fund|withdraw>
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TransactionBuilder } from 'cashscript';
import { generatePrivateKey, encodePrivateKeyWif } from '@bitauth/libauth';
import { TOKEN_DUST, BCH_DUST } from '@regulars/contracts';
import { isSupply } from './issue.js';
import { ENV_PATH, merchantWallet, need, network, provider as makeProvider, reserveFor } from './config.js';

const [command, arg] = process.argv.slice(2);
const provider = makeProvider();

function setEnv(values: Record<string, string>) {
  if (!existsSync(ENV_PATH)) copyFileSync(fileURLToPath(new URL('../../.env.example', import.meta.url)), ENV_PATH);
  let text = readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(ENV_PATH, text);
}

const fee = (builder: TransactionBuilder) => BigInt(builder.build().length / 2) + 10n;

async function keygen() {
  if (process.env.MERCHANT_WIF?.trim()) throw new Error('MERCHANT_WIF is already set in .env; refusing to overwrite it');
  const wif = encodePrivateKeyWif(generatePrivateKey(), network === 'mainnet' ? 'mainnet' : 'testnet');
  const merchant = merchantWallet(wif);
  setEnv({ MERCHANT_WIF: wif, VITE_MERCHANT_ADDRESS: merchant.address, VITE_MERCHANT_PKH: merchant.pkhHex });
  console.log(`Key written to ${ENV_PATH} (not shown here).\nFund this address with a little BCH on ${network}:\n  ${merchant.address}`);
}

async function status() {
  const merchant = merchantWallet();
  const utxos = await provider.getUtxos(merchant.address);
  const bch = utxos.filter((u) => !u.token).reduce((sum, u) => sum + u.satoshis, 0n);
  console.log(`Network   ${network}\nMerchant  ${merchant.address}\nTokens    ${merchant.tokenAddress}\nBCH       ${bch} sats`);
  const category = process.env.STAMP_CATEGORY?.trim();
  if (!category) return console.log('Stamps    not minted yet (run: setup mint)');
  const supply = utxos.filter((u) => u.token?.category === category).reduce((sum, u) => sum + u.token!.amount, 0n);
  const reserve = reserveFor(merchant.pkhHex, provider);
  const held = await reserve.getUtxos();
  const till = utxos.filter((u) => isSupply(u, category)).reduce((sum, u) => sum + u.satoshis, 0n);
  console.log(`Stamps    ${supply} left to issue (category ${category})`);
  console.log(`Till      ${till} sats across ${utxos.filter((u) => isSupply(u, category)).length} supply output(s) (fee tank + takings)`);
  console.log(`Reserve   ${reserve.address}`);
  console.log(`          ${held.reduce((s, u) => s + u.satoshis, 0n)} sats, ${held.reduce((s, u) => s + (u.token?.amount ?? 0n), 0n)} stamps collected, in ${held.length} UTXO(s)`);
}

/** Create the stamp token. A token's category is the txid of a spent output with index 0. */
async function mint(supplyArg = '1000000') {
  if (process.env.STAMP_CATEGORY?.trim()) throw new Error('STAMP_CATEGORY is already set; this merchant already has stamps');
  const merchant = merchantWallet();
  const supply = BigInt(supplyArg);
  let utxos = (await provider.getUtxos(merchant.address)).filter((u) => !u.token);
  let genesis = utxos.find((u) => u.vout === 0);

  if (!genesis) {
    const source = utxos.sort((a, b) => Number(b.satoshis - a.satoshis))[0];
    if (!source) throw new Error(`No BCH at ${merchant.address}; fund it first`);
    const prepare = (f: bigint) => new TransactionBuilder({ provider })
      .addInput(source, merchant.signer.unlockP2PKH())
      .addOutput({ to: merchant.address, amount: source.satoshis - f });
    const sent = await prepare(fee(prepare(500n))).send();
    console.log(`Prepared a genesis input: ${sent.txid}`);
    utxos = (await provider.getUtxos(merchant.address)).filter((u) => !u.token);
    genesis = utxos.find((u) => u.txid === sent.txid && u.vout === 0);
    if (!genesis) throw new Error('Genesis input not visible yet; run mint again in a few seconds');
  }

  const category = genesis.txid;
  const build = (f: bigint) => {
    const change = genesis.satoshis - TOKEN_DUST - f;
    if (change < BCH_DUST) throw new Error('Not enough BCH to mint; fund the merchant address with a few thousand sats more');
    return new TransactionBuilder({ provider })
      .addInput(genesis, merchant.signer.unlockP2PKH())
      .addOutput({ to: merchant.tokenAddress, amount: TOKEN_DUST, token: { category, amount: supply } })
      .addOutput({ to: merchant.address, amount: change });
  };
  const sent = await build(fee(build(500n))).send();
  setEnv({ STAMP_CATEGORY: category, VITE_STAMP_CATEGORY: category });
  console.log(`Minted ${supply} stamps in ${sent.txid}\nCategory ${category} written to .env`);
}

/** Spread the stamp supply over several outputs so simultaneous payments do not queue behind one. */
async function split(countArg = '8') {
  const merchant = merchantWallet();
  const category = need('STAMP_CATEGORY');
  const count = BigInt(countArg);
  const perOutputSats = 20_000n; // fee tank per output
  const utxos = await provider.getUtxos(merchant.address);
  const supplies = utxos.filter((u) => isSupply(u, category));
  const coins = utxos.filter((u) => !u.token);
  const stamps = supplies.reduce((sum, u) => sum + u.token!.amount, 0n);
  const total = [...supplies, ...coins].reduce((sum, u) => sum + u.satoshis, 0n);
  if (stamps < count) throw new Error('Not enough stamps to split');
  const build = (f: bigint) => {
    const change = total - perOutputSats * count - f;
    if (change < 0n) throw new Error(`Need ${perOutputSats * count} sats to fuel ${count} outputs; have ${total}`);
    const builder = new TransactionBuilder({ provider }).addInputs([...supplies, ...coins], merchant.signer.unlockP2PKH());
    for (let i = 0n; i < count; i++) {
      const amount = stamps / count + (i === 0n ? stamps % count : 0n);
      builder.addOutput({ to: merchant.tokenAddress, amount: perOutputSats, token: { category, amount } });
    }
    return change >= BCH_DUST ? builder.addOutput({ to: merchant.address, amount: change }) : builder;
  };
  const sent = await build(fee(build(2000n))).send();
  console.log(`Supply split into ${count} outputs of ${perOutputSats} sats each (${sent.txid})`);
}

/** Move BCH into the supply UTXO, which pays the network fee each time stamps are issued. */
async function fuel(satsArg = '50000') {
  const merchant = merchantWallet();
  const category = need('STAMP_CATEGORY');
  const amount = BigInt(satsArg);
  const utxos = await provider.getUtxos(merchant.address);
  const supply = utxos.find((u) => isSupply(u, category));
  if (!supply) throw new Error('No stamp supply found; run: setup mint');
  const coins = utxos.filter((u) => !u.token);
  const total = coins.reduce((sum, u) => sum + u.satoshis, 0n);
  const build = (f: bigint) => {
    const change = total - amount - f;
    if (change < 0n) throw new Error(`Merchant address holds ${total} plain sats; cannot move ${amount}`);
    const builder = new TransactionBuilder({ provider })
      .addInput(supply, merchant.signer.unlockP2PKH())
      .addInputs(coins, merchant.signer.unlockP2PKH())
      .addOutput({ to: merchant.tokenAddress, amount: supply.satoshis + amount, token: supply.token });
    return change >= BCH_DUST ? builder.addOutput({ to: merchant.address, amount: change }) : builder;
  };
  const sent = await build(fee(build(1000n))).send();
  console.log(`Supply UTXO now holds ${supply.satoshis + amount} sats for fees (${sent.txid})`);
}

/** Move BCH from the merchant address into the reward reserve. */
async function fund(satsArg?: string) {
  if (!satsArg) throw new Error('Usage: setup fund <sats>');
  const merchant = merchantWallet();
  const amount = BigInt(satsArg);
  const reserve = reserveFor(merchant.pkhHex, provider);
  const utxos = (await provider.getUtxos(merchant.address)).filter((u) => !u.token);
  const total = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  const build = (f: bigint) => {
    const change = total - amount - f;
    if (change < 0n) throw new Error(`Merchant address holds ${total} sats; cannot fund ${amount}`);
    const builder = new TransactionBuilder({ provider })
      .addInputs(utxos, merchant.signer.unlockP2PKH())
      .addOutput({ to: reserve.address, amount });
    return change >= BCH_DUST ? builder.addOutput({ to: merchant.address, amount: change }) : builder;
  };
  const sent = await build(fee(build(1000n))).send();
  console.log(`Funded reserve ${reserve.address} with ${amount} sats in ${sent.txid}`);
}

/** Close the reserve: BCH back to the merchant, collected stamps back into the issuing supply. */
async function withdraw() {
  const merchant = merchantWallet();
  const category = need('STAMP_CATEGORY');
  const reserve = reserveFor(merchant.pkhHex, provider);
  const held = await reserve.getUtxos();
  if (held.length === 0) throw new Error('Reserve is empty');
  const sats = held.reduce((s, u) => s + u.satoshis, 0n);
  const stamps = held.reduce((s, u) => s + (u.token?.category === category ? u.token.amount : 0n), 0n);
  const build = (f: bigint) => {
    const builder = new TransactionBuilder({ provider })
      .addInputs(held, reserve.unlock.withdraw(merchant.signer.publicKey, merchant.signer));
    let back = sats - f;
    if (stamps > 0n) {
      builder.addOutput({ to: merchant.tokenAddress, amount: TOKEN_DUST, token: { category, amount: stamps } });
      back -= TOKEN_DUST;
    }
    return builder.addOutput({ to: merchant.address, amount: back });
  };
  const sent = await build(fee(build(1000n))).send();
  console.log(`Withdrew ${sats} sats and ${stamps} stamps in ${sent.txid}`);
}

const commands: Record<string, (arg?: string) => Promise<unknown>> = { keygen, status, mint, split, fuel, fund, withdraw };
const run = commands[command ?? ''];
if (!run) {
  console.error('Usage: npm run setup -w server -- <keygen | status | mint [supply] | split [outputs] | fuel [sats] | fund <sats> | withdraw>');
  process.exit(1);
}
run(arg).then(() => process.exit(0), (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
