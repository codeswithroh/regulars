import { describe, it, expect } from 'vitest';
import 'cashscript/vitest';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, randomToken } from 'cashscript';
import { secp256k1, hash160, binToHex, encodeCashAddress, generatePrivateKey } from '@bitauth/libauth';
import { makeReserve, buildRedeem, type ReserveParams } from '../src/index.js';

const wallet = () => {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pub);
  const addr = (type: 'p2pkh' | 'p2pkhWithTokens') =>
    encodeCashAddress({ prefix: 'bchtest', type, payload: pkh, throwErrors: true }).address;
  return { priv, pub, pkh: binToHex(pkh), address: addr('p2pkh'), tokenAddress: addr('p2pkhWithTokens'), sig: new SignatureTemplate(priv) };
};

const CATEGORY = 'aa'.repeat(31) + '01';
const OTHER = 'bb'.repeat(32);

function setup(reserveToken?: { category: string; amount: bigint }) {
  const provider = new MockNetworkProvider();
  const merchant = wallet();
  const customer = wallet();
  const params: ReserveParams = { stampCategory: CATEGORY, satsPerStamp: 200n, merchantPkh: merchant.pkh };
  const reserve = makeReserve(params, provider);
  const reserveUtxo = provider.addUtxo(reserve.tokenAddress, randomUtxo({ satoshis: 100_000n, token: reserveToken }));
  const stampUtxo = (category = CATEGORY, amount = 10n) => {
    return provider.addUtxo(customer.tokenAddress, randomUtxo({ satoshis: 1000n, token: randomToken({ category, amount }) }));
  };
  return { provider, merchant, customer, params, reserve, reserveUtxo, stampUtxo };
}

describe('RewardReserve.redeem', () => {
  it('pays satsPerStamp for every stamp handed in', async () => {
    const s = setup();
    const { builder, plan } = buildRedeem({
      ...s, stampInputs: [{ utxo: s.stampUtxo(), unlocker: s.customer.sig.unlockP2PKH() }], stamps: 10n,
      customerAddress: s.customer.address, customerTokenAddress: s.customer.tokenAddress,
    });
    await builder.send();
    expect(plan.payout).toBe(1000n + 2000n - plan.fee);
    const [after] = await s.reserve.getUtxos();
    expect(after.satoshis).toBe(98_000n);
    expect(after.token).toMatchObject({ category: CATEGORY, amount: 10n });
  });

  it('adds to stamps the reserve already holds and returns stamp change', async () => {
    const s = setup({ category: CATEGORY, amount: 7n });
    const { builder, plan } = buildRedeem({
      ...s, stampInputs: [{ utxo: s.stampUtxo(), unlocker: s.customer.sig.unlockP2PKH() }], stamps: 8n,
      customerAddress: s.customer.address, customerTokenAddress: s.customer.tokenAddress,
    });
    await builder.send();
    expect(plan.stampChange).toBe(2n);
    const [after] = await s.reserve.getUtxos();
    expect(after.token?.amount).toBe(15n);
    expect(after.satoshis).toBe(98_400n);
  });

  const raw = (s: ReturnType<typeof setup>, stamp: ReturnType<ReturnType<typeof setup>['stampUtxo']>) =>
    new TransactionBuilder({ provider: s.provider, allowImplicitFungibleTokenBurn: true })
      .addInput(s.reserveUtxo, s.reserve.unlock.redeem())
      .addInput(stamp, s.customer.sig.unlockP2PKH());

  it('rejects taking more than the stamps are worth', () => {
    const s = setup();
    const tx = raw(s, s.stampUtxo())
      .addOutput({ to: s.reserve.tokenAddress, amount: 97_999n, token: { category: CATEGORY, amount: 10n } })
      .addOutput({ to: s.customer.address, amount: 2500n });
    expect(tx).toFailRequireWith('payout exceeds stamps handed in');
  });

  it('rejects a payout with no stamps handed in', () => {
    const s = setup({ category: CATEGORY, amount: 5n });
    const tx = raw(s, s.stampUtxo())
      .addOutput({ to: s.reserve.tokenAddress, amount: 90_000n, token: { category: CATEGORY, amount: 5n } })
      .addOutput({ to: s.customer.tokenAddress, amount: 1000n, token: { category: CATEGORY, amount: 10n } })
      .addOutput({ to: s.customer.address, amount: 9000n });
    expect(tx).toFailRequireWith('no stamps handed in');
  });

  it('rejects tokens from another category', () => {
    const s = setup();
    const tx = raw(s, s.stampUtxo(OTHER))
      .addOutput({ to: s.reserve.tokenAddress, amount: 98_000n, token: { category: OTHER, amount: 10n } })
      .addOutput({ to: s.customer.address, amount: 2500n });
    expect(tx).toFailRequireWith("reserve output must hold this merchant's stamps");
  });

  it('rejects counting a foreign token already in the reserve as stamps', () => {
    const s = setup({ category: OTHER, amount: 1n });
    const tx = raw(s, s.stampUtxo())
      .addOutput({ to: s.reserve.tokenAddress, amount: 98_000n, token: { category: CATEGORY, amount: 10n } })
      .addOutput({ to: s.customer.address, amount: 2500n });
    expect(tx).toFailRequireWith('reserve input holds a foreign token');
  });

  it('rejects sending the reserve somewhere else', () => {
    const s = setup();
    const tx = raw(s, s.stampUtxo())
      .addOutput({ to: s.customer.tokenAddress, amount: 98_000n, token: { category: CATEGORY, amount: 10n } })
      .addOutput({ to: s.customer.address, amount: 2500n });
    expect(tx).toFailRequireWith('reserve must be recreated at the same index');
  });
});

describe('RewardReserve.withdraw', () => {
  it('lets the merchant close the reserve', async () => {
    const s = setup();
    const tx = new TransactionBuilder({ provider: s.provider })
      .addInput(s.reserveUtxo, s.reserve.unlock.withdraw(s.merchant.pub, s.merchant.sig))
      .addOutput({ to: s.merchant.address, amount: 99_000n });
    await expect(tx.send()).resolves.toBeDefined();
  });

  it('refuses anyone else', () => {
    const s = setup();
    const tx = new TransactionBuilder({ provider: s.provider })
      .addInput(s.reserveUtxo, s.reserve.unlock.withdraw(s.customer.pub, s.customer.sig))
      .addOutput({ to: s.customer.address, amount: 99_000n });
    expect(tx).toFailRequireWith('not the merchant');
  });
});
