// Executes the Regulars XO template on chipnet against the live demo shop:
//   1. `earn`   pay the shop and receive stamps, through an XO invitation
//   2. `redeem` the follow-up action on the stamps output, through a second invitation
// Each invitation is saved to xo/invitations/ for the XO debug tool (https://blaze.xo.cash/).
// Usage: npm run run:chipnet -w xo      (needs the chipnet .env from `npm run shop -- keygen/open`)
// The engine's default storage is IndexedDB; this provides it in Node, in memory. (Its SQLite
// backend in 0.1.1-next fails on start: State.listScriptHashes is missing from the adapter.)
import 'fake-indexeddb/auto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TransactionBuilder } from 'cashscript';
import { generateBip39Mnemonic, hexToBin, binToHex, lockingBytecodeToCashAddress, encodeDataPush, flattenBinArray, decodeTransaction, createVirtualMachineBch, stringify } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS, DUST_LIMIT_SATOSHIS, getTemplateLockingScriptOrThrow } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { serializeInvitation } from '@xo-cash/utils';
import { makeIssuer, makeReserve } from '@regulars/contracts';
import { ENV_PATH, demoShop, env, network, ownerWallet, protocol, withConnection } from '@regulars/cli/src/config.ts';
import { regularsTemplate } from './template.js';

if (network !== 'chipnet') throw new Error('This runner is for chipnet; set NETWORK=chipnet');
// 20 stamps redeem for 600 sats, enough that the change clears dust after the network fee.
const STAMPS = 20n;
const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...a: unknown[]) => console.log(...a);

// A dedicated test account. The mnemonic is kept in .env and never printed.
let mnemonic = env('XO_MNEMONIC');
if (!mnemonic) {
  mnemonic = generateBip39Mnemonic();
  writeFileSync(ENV_PATH, `${readFileSync(ENV_PATH, 'utf8').trimEnd()}\nXO_MNEMONIC=${mnemonic}\n`);
  log('Created a test XO account (mnemonic saved to .env)');
}

const shop = demoShop();
const fees = protocol();
mkdirSync(here('invitations'), { recursive: true });

const engine = await Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet });

try {
  const { templateIdentifier: p2pkhId } = await engine.importTemplate(p2pkhTemplate);
  const { templateIdentifier } = await engine.importTemplate(regularsTemplate);
  await engine.setDefaultPolicies({ change: { templateIdentifier: p2pkhId }, receive: { templateIdentifier: p2pkhId }, address: { templateIdentifier: p2pkhId } });
  log(`Template imported: ${templateIdentifier}`);

  // Fund the account from the owner key when it runs low. The engine tracks the receive address
  // and syncs it in the background, so give it a moment before reading the balance.
  const plainCoins = async () => (await engine.listSpendableUnspentOutputs()).filter((u) => !u.tokenCategory);
  const plainBalance = async () => (await plainCoins()).reduce((s, u) => s + BigInt(u.valueSatoshis), 0n);
  const waitForBalance = async (seconds: number) => {
    for (let i = 0; i < seconds && (await plainBalance()) < 30_000n; i++) await sleep(1000);
    return plainBalance();
  };
  const receive = await engine.generateLockingBytecodeFromDefaultPolicy('receive');
  const address = lockingBytecodeToCashAddress({ bytecode: hexToBin(receive), prefix: 'bchtest' });
  if (typeof address === 'string') throw new Error(address);
  if ((await waitForBalance(8)) < 30_000n) {
    await withConnection(async (provider) => {
      const owner = ownerWallet();
      const coin = (await provider.getUtxos(owner.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
      await new TransactionBuilder({ provider }).addInput(coin, owner.signer.unlockP2PKH())
        .addOutput({ to: address.address, amount: 60_000n }).addOutput({ to: owner.address, amount: coin.satoshis - 60_300n }).send();
    });
    if ((await waitForBalance(60)) < 30_000n) throw new Error(`Sent 60,000 sats to ${address.address} but the XO account has not seen them after 60s`);
    log(`Funded XO account ${address.address}`);
  }
  log(`XO account balance: ${await plainBalance()} sats`);

  const variables = (values: Record<string, unknown>) =>
    Object.entries(values).map(([variableIdentifier, value]) => ({ variableIdentifier, roleIdentifier: 'customer', value: value as never }));
  const shopValues = {
    stampCategory: shop.category,
    merchantPkh: shop.merchantPkh,
    satsPerStampEarned: shop.earn,
    satsPerStampRedeemed: shop.redeem,
  };

  /** Finish an invitation the way every XO action ends: change, sign, execute, share. */
  async function complete(invitationIdentifier: string, name: string) {
    const change = await engine.calculateChange(invitationIdentifier);
    const fee = BigInt(await engine.estimateTransactionFee(invitationIdentifier));
    if (change.valueSatoshis - fee >= BigInt(DUST_LIMIT_SATOSHIS) || change.tokens.length > 0) await engine.addChangeToInvitation(invitationIdentifier);
    for (const inputIndex of await engine.listOwnInputIndexes(invitationIdentifier)) await engine.signInvitation(invitationIdentifier, inputIndex);
    const missing = await engine.listMissingRequirements(invitationIdentifier);
    const left = JSON.stringify(missing, (_k, x) => (typeof x === 'bigint' ? String(x) : x));
    if (missing.inputsMissingSignatures?.length || missing.participants?.length) throw new Error(`${name} still needs: ${left}`);
    await verifyLocally(invitationIdentifier, name);
    const { builtTransaction, storedInvitation } = await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
    const file = here(`invitations/${name}-chipnet.txt`);
    writeFileSync(file, `${serializeInvitation(storedInvitation.invitation)}\n`);
    log(`${name}: broadcast ${builtTransaction.transactionHash}\n  invitation saved to xo/invitations/${name}-chipnet.txt`);
    return builtTransaction.transactionHash;
  }

  /** Build XO's transaction and run every input through the BCH VM before anything is broadcast. */
  async function verifyLocally(invitationIdentifier: string, name: string) {
    const { serializedTransaction } = await engine.buildInvitationTransactionFromMergedCommit(invitationIdentifier);
    const tx = decodeTransaction(typeof serializedTransaction === 'string' ? hexToBin(serializedTransaction) : serializedTransaction);
    if (typeof tx === 'string') throw new Error(tx);
    const sourceOutputs = await withConnection((provider) => Promise.all(tx.inputs.map(async (input) => {
      const parent = decodeTransaction(hexToBin(await provider.getRawTransaction(binToHex(input.outpointTransactionHash))));
      if (typeof parent === 'string') throw new Error(parent);
      return parent.outputs[input.outpointIndex];
    })));
    const result = createVirtualMachineBch().verify({ transaction: tx, sourceOutputs });
    if (result !== true) {
      console.error(`${name}: local VM rejects XO's transaction: ${result}`);
      console.error(stringify({ outputs: tx.outputs.map((o) => ({ lock: binToHex(o.lockingBytecode), value: o.valueSatoshis, token: o.token && { category: binToHex(o.token.category), amount: o.token.amount } })) }));
      throw new Error(`${name} would be rejected`);
    }
    log(`  ${name}: transaction verified by the local BCH VM`);
  }

  /** Never broadcast unless XO builds the same contract address the web app uses. */
  async function assertSameContract(invitationIdentifier: string, outputIdentifier: string, expected: string) {
    const built = await engine.resolveInvitationOutputLockingBytecode(invitationIdentifier, outputIdentifier);
    if (built !== expected) throw new Error(`${outputIdentifier}: XO built ${built}, CashScript expects ${expected}`);
    log(`  ${outputIdentifier} locking bytecode matches the CashScript contract`);
  }

  // The engine only compiles unlocking bytecode for outputs this account tracks, and offers no way
  // to track a covenant someone else created. Both contracts take no signature, so their unlocking
  // bytecode is the template's own script, `OP_0 <redeem script>`, supplied with the input.
  const contractUnlock = (redeemScriptHex: string) => flattenBinArray([Uint8Array.of(0x00), encodeDataPush(hexToBin(redeemScriptHex))]);

  // ---------- 1. earn ----------
  const { issuerUtxo, issuer, reserve, reserveUtxo } = await withConnection(async (provider) => {
    const issuerContract = makeIssuer(shop, fees, provider);
    const reserveContract = makeReserve(shop, provider);
    const issuers = await issuerContract.getUtxos();
    const reserves = await reserveContract.getUtxos();
    return {
      issuer: issuerContract, reserve: reserveContract,
      issuerUtxo: issuers[Math.floor(Math.random() * issuers.length)],
      reserveUtxo: [...reserves].sort((a, b) => Number(b.satoshis - a.satoshis))[0],
    };
  });
  const template = (await engine.getTemplate(templateIdentifier))!;
  const earnIntent = template.start!.find((i) => i.action === 'earn')!;
  const funding = (await plainCoins()).sort((a, b) => Number(BigInt(b.valueSatoshis) - BigInt(a.valueSatoshis)))[0];

  const earn = await engine.createInvitation({
    templateIdentifier,
    actionIdentifier: 'earn',
    intent: earnIntent,
    variables: variables({ ...shopValues, feePerStamp: fees.feePerStamp, protocolPkh: fees.protocolPkh, issuerSatoshis: issuerUtxo.satoshis, issuerStamps: issuerUtxo.token!.amount, stamps: STAMPS }),
    inputs: [
      { inputIdentifier: 'issuerInput', outpointTransactionHash: hexToBin(issuerUtxo.txid), outpointIndex: issuerUtxo.vout, unlockingBytecode: contractUnlock(issuer.bytecode) },
      { outpointTransactionHash: hexToBin(funding.outpointTransactionHash), outpointIndex: funding.outpointIndex },
    ],
  });
  const earnId = earn.invitation.invitationIdentifier;
  await engine.appendInvitation(earnId, {
    templateIdentifier, actionIdentifier: 'earn',
    outputs: [{ outputIdentifier: 'issuerOutput' }, { outputIdentifier: 'shopPaymentOutput' }, { outputIdentifier: 'stampsOutput', roleIdentifier: 'customer' }],
  });
  await assertSameContract(earnId, 'issuerOutput', issuer.lockingBytecode);
  const earnTxid = await complete(earnId, 'earn');

  // ---------- 2. redeem (follow-up on the stamps output) ----------
  // Redeem every stamps output the account holds (earlier runs may have left some).
  type Unspent = Awaited<ReturnType<typeof engine.listUnspentOutputs>>[number] & { tokenCategory?: string; tokenAmount?: bigint | string };
  const stampsHeld = async () => ((await engine.listUnspentOutputs()) as Unspent[]).filter((u) => u.tokenCategory === shop.category);
  let held: Unspent[] = [];
  for (let i = 0; i < 30; i++) {
    held = await stampsHeld();
    if (held.some((u) => u.outpointTransactionHash === earnTxid)) break;
    await sleep(1000);
  }
  if (!held.some((u) => u.outpointTransactionHash === earnTxid)) throw new Error('Stamps from earn not visible to the XO account');
  const stampsTotal = held.reduce((sum, u) => sum + BigInt(u.tokenAmount ?? 0), 0n);
  const [script] = await engine.listScriptHashData({ scriptHash: held[0].scriptHash });
  const lockingScript = getTemplateLockingScriptOrThrow(template, script.lockingScriptIdentifier);
  const redeemIntent = (lockingScript.roles?.[script.roleIdentifier ?? '']?.actions ?? []).find((i) => i.action === 'redeem');
  if (!redeemIntent) throw new Error('The stamps output does not offer the redeem follow-up');
  log(`Follow-up found on ${script.lockingScriptIdentifier}: ${redeemIntent.action} (${stampsTotal} stamps in ${held.length} output(s))`);

  const redeem = await engine.createInvitation({
    templateIdentifier,
    actionIdentifier: 'redeem',
    intent: redeemIntent,
    variables: variables({ ...shopValues, reserveSatoshis: reserveUtxo.satoshis, reserveStamps: reserveUtxo.token?.amount ?? 0n, stamps: stampsTotal }),
    inputs: [
      { inputIdentifier: 'reserveInput', outpointTransactionHash: hexToBin(reserveUtxo.txid), outpointIndex: reserveUtxo.vout, unlockingBytecode: contractUnlock(reserve.bytecode) },
      ...held.map((u) => ({ outpointTransactionHash: hexToBin(u.outpointTransactionHash), outpointIndex: u.outpointIndex })),
    ],
  });
  const redeemId = redeem.invitation.invitationIdentifier;
  await engine.appendInvitation(redeemId, { templateIdentifier, actionIdentifier: 'redeem', outputs: [{ outputIdentifier: 'reserveOutput' }] });
  await assertSameContract(redeemId, 'reserveOutput', reserve.lockingBytecode);
  await complete(redeemId, 'redeem');
} finally {
  await engine.stop();
}
process.exit(0);
