// Owner commands:  npm run shop -w cli -- <keygen | status | open [name] [reserveSats] | collect | sweep-legacy | identity>
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TransactionBuilder } from 'cashscript';
import { generatePrivateKey, encodePrivateKeyWif } from '@bitauth/libauth';
import { buildCollect, buildCreateShop, makeIssuer, makeReserve, shopPath } from '@regulars/contracts';
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { signMessage, verificationText, identityEvent, currentClaims, publish, findByPubkey } from '@regulars/bch-nostr-id';
import { decodePrivateKeyWif, binToHex, hexToBin } from '@bitauth/libauth';
import { ENV_PATH, demoShop, env, need, network, ownerWallet, protocol, withConnection } from './config.js';

const [command, ...args] = process.argv.slice(2);

function setEnv(values: Record<string, string>) {
  if (!existsSync(ENV_PATH)) copyFileSync(fileURLToPath(new URL('../../.env.example', import.meta.url)), ENV_PATH);
  let text = readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(ENV_PATH, text);
}

async function keygen() {
  if (env('MERCHANT_WIF')) throw new Error('MERCHANT_WIF is already set; refusing to overwrite it');
  const wif = encodePrivateKeyWif(generatePrivateKey(), network === 'mainnet' ? 'mainnet' : 'testnet');
  const owner = ownerWallet(wif);
  setEnv({ MERCHANT_WIF: wif, VITE_PROTOCOL_PKH: owner.pkhHex });
  console.log(`Key written to ${ENV_PATH} (not shown here).\nFund this address with a little BCH on ${network}:\n  ${owner.address}`);
}

const status = () => withConnection(async (provider) => {
  const owner = ownerWallet();
  const utxos = await provider.getUtxos(owner.address);
  console.log(`Network   ${network}\nOwner     ${owner.address}\nTokens    ${owner.tokenAddress}`);
  console.log(`BCH       ${utxos.filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n)} sats plain, ${utxos.filter((u) => u.token).length} token output(s)`);
  if (!env('VITE_DEMO_SHOP')) return console.log('Demo shop not opened yet (run: shop open)');
  const shop = demoShop();
  const issuers = await makeIssuer(shop, protocol(), provider).getUtxos();
  const reserve = await makeReserve(shop, provider).getUtxos();
  console.log(`Shop      ${shop.name}: 1 stamp per ${shop.earn} sats, ${shop.redeem} sats per stamp`);
  console.log(`Link      /#${shopPath(shop)}`);
  console.log(`Issuers   ${issuers.reduce((s, u) => s + (u.token?.amount ?? 0n), 0n)} stamps left in ${issuers.length} output(s), ${issuers.reduce((s, u) => s + u.satoshis - 1000n, 0n)} sats of protocol fees accrued`);
  console.log(`Reserve   ${reserve.reduce((s, u) => s + u.satoshis, 0n)} sats, ${reserve.reduce((s, u) => s + (u.token?.amount ?? 0n), 0n)} stamps redeemed so far`);
});

/** Open the demo shop with the owner key, exactly as the web app does with a connected wallet. */
const open = (name = 'Demo Café', reserveArg = '100000') => withConnection(async (provider) => {
  const owner = ownerWallet();
  const unlocker = owner.signer.unlockP2PKH();
  const plain = async () => (await provider.getUtxos(owner.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
  let coins = await plain();
  if (!coins.length) throw new Error(`No BCH at ${owner.address}; fund it first`);
  let genesis = coins.find((u) => u.vout === 0);
  if (!genesis) {
    // A token category is the txid of a spent output 0, so make one.
    const sum = coins.reduce((s, u) => s + u.satoshis, 0n);
    const prepare = (fee: bigint) => new TransactionBuilder({ provider }).addInputs(coins, unlocker).addOutput({ to: owner.address, amount: sum - fee });
    await prepare(BigInt(prepare(1000n).build().length / 2) + 10n).send();
    coins = await plain();
    genesis = coins.find((u) => u.vout === 0);
    if (!genesis) throw new Error('Prepared coin not visible yet; run the command again');
  }
  const { builder, shop } = buildCreateShop({
    genesis: { utxo: genesis, unlocker },
    coins: coins.filter((u) => u !== genesis).map((utxo) => ({ utxo, unlocker })),
    name, merchantPkh: owner.pkhHex,
    earn: BigInt(env('SATS_PER_STAMP_EARNED') || '1000'), redeem: BigInt(env('SATS_PER_STAMP') || '30'),
    protocol: protocol(), supply: 1_000_000n, issuerOutputs: 8, reserveSats: BigInt(reserveArg),
    changeAddress: owner.address, provider,
  });
  const sent = await builder.send();
  setEnv({ VITE_DEMO_SHOP: shopPath(shop), VITE_PROTOCOL_PKH: protocol().protocolPkh });
  console.log(`Opened "${shop.name}" in ${sent.txid}\nLink: /#${shopPath(shop)}`);
});

/** Forward accrued protocol fees from any issuer output that has built up enough. */
const collect = () => withConnection(async (provider) => {
  const shop = demoShop();
  const ready = (await makeIssuer(shop, protocol(), provider).getUtxos()).filter((u) => u.satoshis >= 20_000n);
  if (!ready.length) return console.log('No issuer output has 20,000 sats of fees yet');
  for (const issuerUtxo of ready) console.log(`Collected in ${(await buildCollect({ shop, protocol: protocol(), issuerUtxo, provider }).builder.send()).txid}`);
});

/** One-off: bring funds from the pre-protocol version (old reserve, old supply outputs) back to plain BCH. */
const sweepLegacy = () => withConnection(async (provider) => {
  const owner = ownerWallet();
  const unlocker = owner.signer.unlockP2PKH();
  const feeOf = (b: TransactionBuilder) => BigInt(b.build().length / 2) + 10n;
  if (env('STAMP_CATEGORY')) {
    const old = { name: '', category: env('STAMP_CATEGORY'), merchantPkh: owner.pkhHex, earn: 0n, redeem: BigInt(env('SATS_PER_STAMP') || '30') };
    const reserve = makeReserve(old, provider);
    const held = await reserve.getUtxos();
    if (held.length) {
      const sum = held.reduce((s, u) => s + u.satoshis, 0n);
      const build = (fee: bigint) => new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
        .addInputs(held, reserve.unlock.withdraw(owner.pub, owner.signer)).addOutput({ to: owner.address, amount: sum - fee });
      console.log(`Old reserve: ${sum} sats withdrawn (${(await build(feeOf(build(2000n))).send()).txid})`);
    }
  }
  const utxos = await provider.getUtxos(owner.address);
  if (!utxos.some((u) => u.token)) return console.log('No old token outputs to sweep');
  const sum = utxos.reduce((s, u) => s + u.satoshis, 0n);
  const build = (fee: bigint) => new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
    .addInputs(utxos, unlocker).addOutput({ to: owner.address, amount: sum - fee });
  console.log(`Swept ${utxos.length} outputs into ${sum} sats (${(await build(feeOf(build(3000n))).send()).txid})`);
});

/**
 * Verify the demo shop: give it a Nostr identity and bind the shop's payout address to it with a signed
 * message, so the shop page shows who runs it. The Nostr key is kept in the env file, never printed.
 */
async function identity(name = demoShop().name) {
  let hex = env('NOSTR_SECRET_HEX');
  if (!hex) { hex = binToHex(generateSecretKey()); setEnv({ NOSTR_SECRET_HEX: hex }); }
  const sk = hexToBin(hex);
  const pubkey = getPublicKey(sk);
  const decoded = decodePrivateKeyWif(need('MERCHANT_WIF'));
  if (typeof decoded === 'string') throw new Error(decoded);
  const owner = ownerWallet();
  const now = Math.floor(Date.now() / 1000);
  const profile = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ name, about: `${name} runs its loyalty programme on Regulars.` }) }, sk);
  const claim = { address: owner.address, proof: { type: 'msg' as const, signature: signMessage(decoded.privateKey, verificationText(pubkey)) } };
  const event = finalizeEvent(identityEvent([claim], await currentClaims(pubkey)), sk);
  console.log(`Profile accepted by ${(await publish(profile)).length} relays; identity by ${(await publish(event)).length} relays`);
  await new Promise((r) => setTimeout(r, 1500));
  const found = await findByPubkey(pubkey);
  console.log(`${nip19.npubEncode(pubkey)}
Verified addresses: ${found?.verified.join(', ') || 'none'}`);
}

/**
 * Send plain BCH from the owner key: `send <address> <sats>` shows the plan; add `--yes` to broadcast.
 * Token outputs are never spent, and the change returns to the owner key.
 */
const send = (to = '', amountArg = '', confirm = '') => withConnection(async (provider) => {
  if (!/^(bitcoincash|bchtest):[qz][0-9a-z]{40,}$/.test(to)) throw new Error('Usage: send <bitcoincash:q… address> <sats> [--yes]');
  if (!/^\d+$/.test(amountArg)) throw new Error('Amount must be a whole number of sats');
  const amount = BigInt(amountArg);
  const owner = ownerWallet();
  const coins = (await provider.getUtxos(owner.address)).filter((u) => !u.token);
  const total = coins.reduce((s, u) => s + u.satoshis, 0n);
  const build = (fee: bigint) => {
    const b = new TransactionBuilder({ provider }).addInputs(coins, owner.signer.unlockP2PKH()).addOutput({ to, amount });
    const change = total - amount - fee;
    if (change >= 546n) b.addOutput({ to: owner.address, amount: change });
    return b;
  };
  const fee = BigInt(build(1000n).build().length / 2) + 10n;
  if (total < amount + fee) throw new Error(`The owner key holds ${total} sats, not enough to send ${amount} plus a ${fee}-sat fee`);
  console.log(`From      ${owner.address} (${total} sats)\nTo        ${to}\nAmount    ${amount} sats\nFee       ${fee} sats\nKept      ${total - amount - fee} sats`);
  if (confirm !== '--yes') return console.log('\nNothing sent. Run again with --yes to broadcast.');
  console.log(`Sent: ${(await build(fee).send()).txid}`);
});

const commands: Record<string, (...a: string[]) => Promise<unknown>> = { keygen, status, open, collect, 'sweep-legacy': sweepLegacy, identity, send };
const run = commands[command ?? ''];
if (!run) {
  console.error('Usage: npm run shop -w cli -- <keygen | status | open [name] [reserveSats] | collect | sweep-legacy | identity [name] | send <address> <sats> [--yes]>');
  process.exit(1);
}
run(...args).then(() => process.exit(0), (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
