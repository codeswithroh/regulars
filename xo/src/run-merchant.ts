// The shop's side of the Regulars XO template, executed on chipnet with one XO account playing both
// roles on a shop it opens itself:
//   1. `openShop`        (merchant) mint the stamps into an issuer contract and fund a reward reserve
//   2. `earn`            (customer) pay the new shop and receive stamps
//   3. `redeemFresh`     (customer) follow-up: the first redemption against a reserve that holds no stamps yet
//   4. `closeIssuer`     (merchant) follow-up on the issuer: take back the unissued stamps
//   5. `withdrawReserve` (merchant) follow-up on the reserve: take back the reserve
// Each invitation is saved to xo/invitations/<action>-chipnet.txt.
// Usage: npm run run:merchant -w xo   (needs the chipnet .env; funds the XO account from the owner key)
import 'fake-indexeddb/auto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MockNetworkProvider, TransactionBuilder } from 'cashscript';
import {
  generateBip39Mnemonic, hexToBin, binToHex, lockingBytecodeToCashAddress, encodeDataPush, flattenBinArray,
  decodeTransaction, createVirtualMachineBch, utf8ToBin, binToUtf8, decodeAuthenticationInstructions,
} from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS, DUST_LIMIT_SATOSHIS, getTemplateLockingScriptOrThrow } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { compileCashAssemblyString, serializeInvitation } from '@xo-cash/utils';
import { makeIssuer, makeReserve, shopPath, type Shop } from '@regulars/contracts';
import { ENV_PATH, env, network, ownerWallet, protocol, withConnection } from '@regulars/cli/src/config.ts';
import { regularsTemplate } from './template.js';

if (network !== 'chipnet') throw new Error('This runner is for chipnet; set NETWORK=chipnet');
const NAME = 'XO Corner Shop';
const EARN = 1000n;      // sats per stamp
const REDEEM = 40n;      // reward per stamp
const SUPPLY = 100_000n;
const RESERVE = 5_000n;
const STAMPS = 20n;      // earned, then redeemed: 800 sats back
const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...a: unknown[]) => console.log(...a);

let mnemonic = env('XO_MNEMONIC');
if (!mnemonic) {
  mnemonic = generateBip39Mnemonic();
  writeFileSync(ENV_PATH, `${readFileSync(ENV_PATH, 'utf8').trimEnd()}\nXO_MNEMONIC=${mnemonic}\n`);
  log('Created a test XO account (mnemonic saved to .env)');
}
const fees = protocol();
mkdirSync(here('invitations'), { recursive: true });
const engine = await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet });

type Unspent = Awaited<ReturnType<typeof engine.listUnspentOutputs>>[number] & { tokenCategory?: string; tokenAmount?: bigint | string };

try {
  const { templateIdentifier: p2pkhId } = await engine.importTemplate(p2pkhTemplate);
  const { templateIdentifier } = await engine.importTemplate(regularsTemplate);
  await engine.setDefaultPolicies({ change: { templateIdentifier: p2pkhId }, receive: { templateIdentifier: p2pkhId }, address: { templateIdentifier: p2pkhId } });
  const template = (await engine.getTemplate(templateIdentifier))!;
  log(`Template imported: ${templateIdentifier}`);

  const plainCoins = async () => ((await engine.listSpendableUnspentOutputs()) as Unspent[]).filter((u) => !u.tokenCategory);
  const receive = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  const address = lockingBytecodeToCashAddress({ bytecode: hexToBin(receive), prefix: 'bchtest' });
  if (typeof address === 'string') throw new Error(address);

  // Opening needs a plain coin at output index 0 (it becomes the stamps' category); the customer's
  // payment needs another of at least 23,000 sats. Send both from the owner key when missing.
  const genesisCoin = async () => (await plainCoins()).find((u) => u.outpointIndex === 0 && BigInt(u.valueSatoshis) >= 15_000n);
  const paymentCoin = async (exclude?: Unspent) => (await plainCoins()).find((u) => u !== exclude && u.outpointTransactionHash + u.outpointIndex !== (exclude ? exclude.outpointTransactionHash + exclude.outpointIndex : '') && BigInt(u.valueSatoshis) >= 25_000n);
  const ready = async () => { const g = await genesisCoin(); return g && (await paymentCoin(g)) ? g : undefined; };
  for (let i = 0; i < 8 && !(await ready()); i++) await sleep(1000);
  if (!(await ready())) {
    const txid = await withConnection(async (provider) => {
      const owner = ownerWallet();
      const coin = (await provider.getUtxos(owner.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
      return (await new TransactionBuilder({ provider }).addInput(coin, owner.signer.unlockP2PKH())
        .addOutput({ to: address.address, amount: 20_000n }).addOutput({ to: address.address, amount: 30_000n })
        .addOutput({ to: owner.address, amount: coin.satoshis - 50_400n }).send()).txid;
    });
    for (let i = 0; i < 60 && !(await ready()); i++) await sleep(1000);
    if (!(await ready())) throw new Error(`Funded ${address.address} (${txid}) but the XO account has not seen it after 60s`);
    log(`Funded XO account ${address.address}`);
  }

  const variables = (role: string, values: Record<string, unknown>) =>
    Object.entries(values).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: role, value: value as never }));

  /** Finish an invitation: change, sign, check in the BCH VM, broadcast, save. */
  async function complete(invitationIdentifier: string, name: string, check?: (tx: Exclude<ReturnType<typeof decodeTransaction>, string>) => void, presigned: number[] = [], change = true) {
    const leftover = await engine.calculateChange(invitationIdentifier);
    const fee = BigInt(await engine.estimateTransactionFee(invitationIdentifier));
    if (change && (leftover.valueSatoshis - fee >= BigInt(DUST_LIMIT_SATOSHIS) || leftover.tokens.length > 0)) await engine.addChangeToInvitation(invitationIdentifier);
    // This account plays both roles, so it also tracks the shop's contracts. A contract input whose
    // unlocking script was compiled up front (the customer's earn/redeem path) must not be signed again.
    for (const inputIndex of await engine.listOwnInputIndexes(invitationIdentifier)) if (!presigned.includes(inputIndex)) await engine.signInvitation(invitationIdentifier, inputIndex);
    const missing = await engine.listMissingRequirements(invitationIdentifier);
    if (missing.inputsMissingSignatures?.length || missing.participants?.length) {
      throw new Error(`${name} still needs: ${JSON.stringify(missing, (_k, x) => (typeof x === 'bigint' ? String(x) : x))}`);
    }
    const { serializedTransaction } = await engine.buildInvitationTransactionFromMergedCommit(invitationIdentifier);
    const tx = decodeTransaction(typeof serializedTransaction === 'string' ? hexToBin(serializedTransaction) : serializedTransaction);
    if (typeof tx === 'string') throw new Error(tx);
    check?.(tx);
    const sourceOutputs = await withConnection((provider) => Promise.all(tx.inputs.map(async (input) => {
      const parent = decodeTransaction(hexToBin(await provider.getRawTransaction(binToHex(input.outpointTransactionHash))));
      if (typeof parent === 'string') throw new Error(parent);
      return parent.outputs[input.outpointIndex];
    })));
    const result = createVirtualMachineBch().verify({ transaction: tx, sourceOutputs });
    if (result !== true) throw new Error(`${name}: the local BCH VM rejects XO's transaction: ${result}`);
    log(`  ${name}: transaction verified by the local BCH VM`);
    const { builtTransaction, storedInvitation } = await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
    writeFileSync(here(`invitations/${name}-chipnet.txt`), `${serializeInvitation(storedInvitation.invitation)}\n`);
    log(`${name}: broadcast ${builtTransaction.transactionHash}\n  invitation saved to xo/invitations/${name}-chipnet.txt`);
    return builtTransaction.transactionHash as string;
  }

  /** Contract inputs nobody in this account signs for: compile the template's own unlocking script. */
  const contractUnlock = (scriptId: string, values: Record<string, unknown>, redeemScriptHex: string) => {
    const asBytes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, ['stampCategory', 'merchantPkh', 'protocolPkh'].includes(k) ? hexToBin(v as string) : v]));
    const compiled = compileCashAssemblyString({
      cashAssemblyText: scriptId, variables: asBytes as never,
      templateVariables: regularsTemplate.variables, templateScripts: regularsTemplate.scripts, evaluationDecodeMode: 'hex',
    });
    const expected = binToHex(flattenBinArray([Uint8Array.of(0x00), encodeDataPush(hexToBin(redeemScriptHex))]));
    if (compiled !== expected) throw new Error(`${scriptId}: template compiled ${compiled.slice(0, 40)}…, CashScript expects ${expected.slice(0, 40)}…`);
    return hexToBin(compiled);
  };

  /** The follow-up actions a tracked output offers, read from the template like a wallet would. */
  async function followUps(output: Unspent) {
    const [script] = await engine.listScriptHashData({ scriptHash: output.scriptHash });
    const lockingScript = getTemplateLockingScriptOrThrow(template, script.lockingScriptIdentifier);
    return { script, intents: lockingScript.roles?.[script.roleIdentifier ?? '']?.actions ?? [] };
  }
  /**
   * The engine budgets a flat fee per input, but a contract input carries its whole redeem script.
   * Size the transaction from what XO built so far plus each input's unlocking script, and return
   * everything else to the shop key in one output.
   */
  async function appendRefund(invitationIdentifier: string, actionIdentifier: string, inputs: { satoshis: bigint; unlockBytes: number }[]) {
    const { serializedTransaction } = await engine.buildInvitationTransactionFromMergedCommit(invitationIdentifier);
    const built = (typeof serializedTransaction === 'string' ? serializedTransaction.length / 2 : (serializedTransaction as Uint8Array).length);
    const size = BigInt(built + inputs.reduce((sum, i) => sum + i.unlockBytes, 0) + 34);
    const refundSatoshis = inputs.reduce((sum, i) => sum + i.satoshis, 0n) - (size + 20n);
    await engine.appendInvitation(invitationIdentifier, {
      templateIdentifier, actionIdentifier,
      outputs: [{ outputIdentifier: 'shopRefundOutput', roleIdentifier: 'merchant' }],
      variables: variables('merchant', { refundSatoshis }),
    });
    log(`  refund ${refundSatoshis} sats to the shop key (fee ${size + 20n} for ~${size} bytes)`);
  }
  // sig + key + selector + the redeem script, with push and length prefixes.
  const contractUnlockBytes = (redeemHex: string) => 66 + 34 + 1 + 3 + redeemHex.length / 2 + 3;
  const P2PKH_UNLOCK_BYTES = 108;

  const waitFor = async <T>(label: string, find: () => Promise<T | undefined>) => {
    for (let i = 0; i < 60; i++) { const found = await find(); if (found) return found; await sleep(1000); }
    throw new Error(`${label}: not visible to the XO account after 60s`);
  };

  // ---------- 1. openShop (merchant) ----------
  const genesis = (await genesisCoin())!;
  const category = genesis.outpointTransactionHash;
  const openIntent = template.start!.find((i) => i.action === 'openShop')!;
  const open = await engine.createInvitation({
    templateIdentifier, actionIdentifier: 'openShop', intent: openIntent,
    variables: variables('merchant', {
      stampCategory: category, satsPerStampEarned: EARN, satsPerStampRedeemed: REDEEM,
      feePerStamp: fees.feePerStamp, protocolPkh: fees.protocolPkh,
      supply: SUPPLY, reserveFunding: RESERVE, shopName: binToHex(utf8ToBin(NAME)),
    }),
    inputs: [{ outpointTransactionHash: hexToBin(genesis.outpointTransactionHash), outpointIndex: 0 }],
  });
  const openId = open.invitation.invitationIdentifier;
  await engine.appendInvitation(openId, {
    templateIdentifier, actionIdentifier: 'openShop',
    outputs: [
      { outputIdentifier: 'shopIssuerOutput', roleIdentifier: 'merchant' },
      { outputIdentifier: 'shopReserveOutput', roleIdentifier: 'merchant' },
      { outputIdentifier: 'announceOutput' },
    ],
  });

  // Read the shop key hash from the announcement, rebuild the contracts with CashScript, and refuse
  // to broadcast unless XO built exactly the same two contract outputs.
  let shop!: Shop;
  const openTxid = await complete(openId, 'openShop', (tx) => {
    if (binToHex(tx.inputs[0].outpointTransactionHash) !== category || tx.inputs[0].outpointIndex !== 0) throw new Error('openShop: the genesis coin is not input 0');
    const pushes = decodeAuthenticationInstructions(tx.outputs[2].lockingBytecode).slice(1).map((i) => ('data' in i ? i.data : new Uint8Array()));
    if (binToUtf8(pushes[0]) !== 'RGLR') throw new Error('openShop: output 2 is not the shop announcement');
    shop = { name: binToUtf8(pushes[2]), category, merchantPkh: binToHex(pushes[1]), earn: EARN, redeem: REDEEM };
    const lock = (contract: { lockingBytecode: string }) => contract.lockingBytecode;
    const issuer = makeIssuer(shop, fees, new MockNetworkProvider());
    const reserve = makeReserve(shop, new MockNetworkProvider());
    if (binToHex(tx.outputs[0].lockingBytecode) !== lock(issuer)) throw new Error('openShop: XO built a different issuer contract than CashScript');
    if (binToHex(tx.outputs[1].lockingBytecode) !== lock(reserve)) throw new Error('openShop: XO built a different reserve contract than CashScript');
    log('  issuer and reserve outputs match the CashScript contracts');
  });
  log(`Shop link: https://regulars-bch.vercel.app/#${shopPath(shop)}  (chipnet build)`);

  // ---------- 2. earn (customer) ----------
  const { issuer, reserve, issuerUtxo } = await withConnection(async (provider) => {
    const issuerContract = makeIssuer(shop, fees, provider);
    const utxo = await waitFor('issuer output', async () => (await issuerContract.getUtxos()).find((u) => u.txid === openTxid));
    return { issuer: issuerContract, reserve: makeReserve(shop, provider), issuerUtxo: utxo };
  });
  const shopValues = { stampCategory: shop.category, merchantPkh: shop.merchantPkh, satsPerStampEarned: EARN, satsPerStampRedeemed: REDEEM };
  const earnValues = { ...shopValues, feePerStamp: fees.feePerStamp, protocolPkh: fees.protocolPkh, issuerSatoshis: issuerUtxo.satoshis, issuerStamps: issuerUtxo.token!.amount, stamps: STAMPS };
  const funding = await waitFor('a coin for the payment', () => paymentCoin());
  const earn = await engine.createInvitation({
    templateIdentifier, actionIdentifier: 'earn', intent: template.start!.find((i) => i.action === 'earn')!,
    variables: variables('customer', earnValues),
    inputs: [
      { inputIdentifier: 'issuerInput', outpointTransactionHash: hexToBin(issuerUtxo.txid), outpointIndex: issuerUtxo.vout, unlockingBytecode: contractUnlock('issuerEarnUnlockingBytecode', earnValues, issuer.bytecode) },
      { outpointTransactionHash: hexToBin(funding.outpointTransactionHash), outpointIndex: funding.outpointIndex },
    ],
  });
  await engine.appendInvitation(earn.invitation.invitationIdentifier, {
    templateIdentifier, actionIdentifier: 'earn',
    outputs: [{ outputIdentifier: 'issuerOutput' }, { outputIdentifier: 'shopPaymentOutput' }, { outputIdentifier: 'stampsOutput', roleIdentifier: 'customer' }],
  });
  const earnTxid = await complete(earn.invitation.invitationIdentifier, 'earn-xo-shop', undefined, [0]);

  // ---------- 3. redeemFresh (customer follow-up) ----------
  const stamps = await waitFor('stamps from earn', async () => {
    for (const u of (await engine.listUnspentOutputs()) as Unspent[]) {
      if (u.outpointTransactionHash !== earnTxid || u.tokenCategory !== shop.category) continue;
      if ((await followUps(u)).script.lockingScriptIdentifier === 'stampsLockingScript') return u;
    }
    return undefined;
  });
  const { intents: stampIntents } = await followUps(stamps);
  const freshIntent = stampIntents.find((i) => i.action === 'redeemFresh');
  if (!freshIntent) throw new Error('The stamps output does not offer redeemFresh');
  const reserveUtxo = await withConnection(async (provider) => (await makeReserve(shop, provider).getUtxos()).find((u) => u.txid === openTxid))
    ?? (() => { throw new Error('reserve output not found'); })();
  if (reserveUtxo.token) throw new Error('The reserve already holds stamps; this run expects a fresh one');
  const redeemValues = { ...shopValues, reserveSatoshis: reserveUtxo.satoshis, stamps: STAMPS };
  const redeem = await engine.createInvitation({
    templateIdentifier, actionIdentifier: 'redeemFresh', intent: freshIntent,
    variables: variables('customer', redeemValues),
    inputs: [
      { inputIdentifier: 'freshReserveInput', outpointTransactionHash: hexToBin(reserveUtxo.txid), outpointIndex: reserveUtxo.vout, unlockingBytecode: contractUnlock('reserveRedeemUnlockingBytecode', redeemValues, reserve.bytecode) },
      { outpointTransactionHash: hexToBin(stamps.outpointTransactionHash), outpointIndex: stamps.outpointIndex },
    ],
  });
  await engine.appendInvitation(redeem.invitation.invitationIdentifier, { templateIdentifier, actionIdentifier: 'redeemFresh', outputs: [{ outputIdentifier: 'freshReserveOutput' }] });
  const redeemTxid = await complete(redeem.invitation.invitationIdentifier, 'redeemFresh', undefined, [0]);

  // ---------- 4. closeIssuer (merchant follow-up on the issuer) ----------
  const tracked = async (txid: string, vout: number) => ((await engine.listUnspentOutputs()) as Unspent[]).find((u) => u.outpointTransactionHash === txid && u.outpointIndex === vout);
  const liveIssuer = await waitFor('the issuer output after earn', () => tracked(earnTxid, 0));
  const { intents: issuerIntents, script: issuerScript } = await followUps(liveIssuer);
  const closeIntent = issuerIntents.find((i) => i.action === 'closeIssuer');
  if (!closeIntent) throw new Error(`The issuer output (${issuerScript.lockingScriptIdentifier}) does not offer closeIssuer to the shop`);
  if (BigInt(liveIssuer.valueSatoshis) > 3000n) throw new Error('This issuer output holds accrued fees; add protocolFeeOutput');
  const extra = await waitFor('a coin for fees', async () => (await plainCoins()).find((u) => BigInt(u.valueSatoshis) >= 2000n));
  const close = await engine.createInvitation({
    templateIdentifier, actionIdentifier: 'closeIssuer', intent: closeIntent,
    inputs: [
      { inputIdentifier: 'closeIssuerInput', outpointTransactionHash: hexToBin(liveIssuer.outpointTransactionHash), outpointIndex: liveIssuer.outpointIndex },
      { outpointTransactionHash: hexToBin(extra.outpointTransactionHash), outpointIndex: extra.outpointIndex },
    ],
  });
  await appendRefund(close.invitation.invitationIdentifier, 'closeIssuer', [
    { satoshis: BigInt(liveIssuer.valueSatoshis), unlockBytes: contractUnlockBytes(issuer.bytecode) },
    { satoshis: BigInt(extra.valueSatoshis), unlockBytes: P2PKH_UNLOCK_BYTES },
  ]);
  await complete(close.invitation.invitationIdentifier, 'closeIssuer', undefined, [], false);

  // ---------- 5. withdrawReserve (merchant follow-up on the reserve) ----------
  const liveReserve = await waitFor('the reserve after the redemption', () => tracked(redeemTxid, 0));
  const { intents: reserveIntents } = await followUps(liveReserve);
  const withdrawIntent = reserveIntents.find((i) => i.action === 'withdrawReserve');
  if (!withdrawIntent) throw new Error('The reserve does not offer withdrawReserve to the shop');
  const withdraw = await engine.createInvitation({
    templateIdentifier, actionIdentifier: 'withdrawReserve', intent: withdrawIntent,
    inputs: [{ inputIdentifier: 'withdrawReserveInput', outpointTransactionHash: hexToBin(liveReserve.outpointTransactionHash), outpointIndex: liveReserve.outpointIndex }],
  });
  await appendRefund(withdraw.invitation.invitationIdentifier, 'withdrawReserve', [
    { satoshis: BigInt(liveReserve.valueSatoshis), unlockBytes: contractUnlockBytes(reserve.bytecode) },
  ]);
  await complete(withdraw.invitation.invitationIdentifier, 'withdrawReserve', undefined, [], false);

  const left = await withConnection(async (provider) => ({ issuers: (await makeIssuer(shop, fees, provider).getUtxos()).length, reserves: (await makeReserve(shop, provider).getUtxos()).length }));
  log(`Shop closed through XO: ${left.issuers} issuer and ${left.reserves} reserve outputs left`);
} finally {
  await engine.stop();
}
process.exit(0);
