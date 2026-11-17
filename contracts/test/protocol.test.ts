import 'cashscript/vitest';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, type SpendableUtxo } from 'cashscript';
import { secp256k1, hash160, binToHex, hexToBin, encodeCashAddress, generatePrivateKey } from '@bitauth/libauth';
import {
  makeIssuer, makeReserve, buildCreateShop, buildEarn, buildRedeem, buildCollect, buildCloseShop, shopPath, parseShopPath,
  type Shop, type Protocol,
} from '../src/index.js';

const wallet = () => {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pub);
  const addr = (type: 'p2pkh' | 'p2pkhWithTokens') => encodeCashAddress({ prefix: 'bchtest', type, payload: pkh, throwErrors: true }).address;
  return { pub, pkh: binToHex(pkh), lock: hexToBin(`76a914${binToHex(pkh)}88ac`), address: addr('p2pkh'), tokenAddress: addr('p2pkhWithTokens'), sig: new SignatureTemplate(priv) };
};

const OTHER = 'bb'.repeat(32);

/** A shop opened through buildCreateShop on a fresh mock chain. */
async function world(options: { supply?: bigint; issuerOutputs?: number } = {}) {
  const provider = new MockNetworkProvider();
  const merchant = wallet();
  const customer = wallet();
  const treasury = wallet();
  const protocol: Protocol = { feePerStamp: 10n, protocolPkh: treasury.pkh };
  const genesis = provider.addUtxo(merchant.address, randomUtxo({ satoshis: 200_000n, vout: 0 }));
  const { builder, shop } = buildCreateShop({
    genesis: { utxo: genesis, unlocker: merchant.sig.unlockP2PKH() }, coins: [],
    name: 'Test Café', merchantPkh: merchant.pkh, earn: 1000n, redeem: 30n, protocol,
    supply: options.supply ?? 1_000_000n, issuerOutputs: options.issuerOutputs ?? 2, reserveSats: 100_000n,
    changeAddress: merchant.address, provider,
  });
  await builder.send();
  const issuer = makeIssuer(shop, protocol, provider);
  const reserve = makeReserve(shop, provider);
  const fund = (sats = 50_000n) => ({ utxo: provider.addUtxo(customer.address, randomUtxo({ satoshis: sats })), unlocker: customer.sig.unlockP2PKH() });
  const earn = async (pay: bigint) => {
    const [issuerUtxo] = await issuer.getUtxos();
    const built = buildEarn({ shop, protocol, issuerUtxo, coins: [fund()], pay, customerAddress: customer.address, customerTokenAddress: customer.tokenAddress, provider });
    await built.builder.send();
    return built.plan;
  };
  const stampsOf = async (address: string) => (await provider.getUtxos(address)).filter((u) => u.token?.category === shop.category);
  return { provider, merchant, customer, treasury, protocol, shop, issuer, reserve, fund, earn, stampsOf };
}

describe('opening a shop', () => {
  it('mints the supply into issuer outputs and funds the reserve in one transaction', async () => {
    const w = await world({ supply: 1_000_001n, issuerOutputs: 4 });
    const issuers = await w.issuer.getUtxos();
    expect(issuers).toHaveLength(4);
    expect(issuers.reduce((s, u) => s + u.token!.amount, 0n)).toBe(1_000_001n);
    expect(issuers.every((u) => u.token!.category === w.shop.category && u.satoshis === 1000n)).toBe(true);
    expect((await w.reserve.getUtxos()).map((u) => u.satoshis)).toEqual([100_000n]);
  });

  it('refuses a genesis coin that is not output 0, and nonsensical rates', () => {
    const provider = new MockNetworkProvider();
    const m = wallet();
    const base = { coins: [], name: 'x', merchantPkh: m.pkh, earn: 1000n, redeem: 30n, protocol: { feePerStamp: 10n, protocolPkh: m.pkh }, supply: 1000n, issuerOutputs: 2, reserveSats: 5000n, changeAddress: m.address, provider };
    const coin = (vout: number) => ({ utxo: provider.addUtxo(m.address, randomUtxo({ satoshis: 50_000n, vout })), unlocker: m.sig.unlockP2PKH() });
    expect(() => buildCreateShop({ ...base, genesis: coin(1) })).toThrow('index 0');
    expect(() => buildCreateShop({ ...base, genesis: coin(0), redeem: 1000n })).toThrow('below the earn rate');
    expect(() => buildCreateShop({ ...base, genesis: coin(0), earn: 10n, redeem: 5n })).toThrow('exceed the protocol fee');
    expect(() => buildCreateShop({ ...base, genesis: coin(0), reserveSats: 10_000_000n })).toThrow('needs');
  });
});

describe('StampIssuer.earn', () => {
  it('pays the shop and delivers stamps in the same transaction, accruing the protocol fee', async () => {
    const w = await world();
    const before = (await w.issuer.getUtxos())[0];
    const plan = await w.earn(5_400n);
    expect(plan).toMatchObject({ stamps: 5n, pay: 5_400n, merchantGets: 5_350n, protocolFee: 50n });
    expect((await w.stampsOf(w.customer.address)).map((u) => u.token!.amount)).toEqual([5n]);
    expect((await w.provider.getUtxos(w.merchant.address)).some((u) => u.satoshis === 5_350n && !u.token)).toBe(true);
    const after = (await w.issuer.getUtxos()).find((u) => u.token!.amount === before.token!.amount - 5n)!;
    expect(after.satoshis).toBe(before.satoshis + 50n);
  });

  it('refuses payments too small to earn a stamp or larger than the wallet', async () => {
    const w = await world();
    const [issuerUtxo] = await w.issuer.getUtxos();
    const args = { shop: w.shop, protocol: w.protocol, issuerUtxo, customerAddress: w.customer.address, customerTokenAddress: w.customer.tokenAddress, provider: w.provider };
    expect(() => buildEarn({ ...args, coins: [w.fund()], pay: 999n })).toThrow('at least 1000 sats');
    expect(() => buildEarn({ ...args, coins: [w.fund(3000n)], pay: 5000n })).toThrow('in total');
  });

  // Hand-built transactions that try to cheat the covenant.
  const attack = async (mutate: (o: { issuerValue: bigint; issuerStamps: bigint; shopValue: bigint; shopLock: Uint8Array | string; issuerTo: string; category: string }) => void) => {
    const w = await world();
    const [issuerUtxo] = await w.issuer.getUtxos();
    const coin = w.fund();
    const o = { issuerValue: issuerUtxo.satoshis + 50n, issuerStamps: issuerUtxo.token!.amount - 5n, shopValue: 4_950n, shopLock: w.merchant.lock as Uint8Array | string, issuerTo: w.issuer.tokenAddress, category: w.shop.category };
    mutate(o);
    return new TransactionBuilder({ provider: w.provider, allowImplicitFungibleTokenBurn: true })
      .addInput(issuerUtxo, w.issuer.unlock.earn())
      .addInput(coin.utxo, coin.unlocker)
      .addOutput({ to: o.issuerTo, amount: o.issuerValue, token: { category: o.category, amount: o.issuerStamps } })
      .addOutput({ to: o.shopLock, amount: o.shopValue })
      .addOutput({ to: w.customer.tokenAddress, amount: 1000n, token: { category: w.shop.category, amount: 5n } })
      .addOutput({ to: w.customer.address, amount: 30_000n });
  };

  it('accepts the exact minimum', async () => { await expect((await attack(() => {})).send()).resolves.toBeDefined(); });
  it('rejects underpaying the shop', async () => { expect(await attack((o) => { o.shopValue = 4_949n; })).toFailRequireWith('shop underpaid'); });
  it('rejects paying someone other than the shop', async () => { const thief = wallet(); expect(await attack((o) => { o.shopLock = thief.lock; })).toFailRequireWith('output 1 must pay the shop'); });
  it('rejects skipping the protocol fee', async () => { expect(await attack((o) => { o.issuerValue -= 1n; })).toFailRequireWith('protocol fee not added'); });
  it('rejects moving the issuer elsewhere', async () => { const thief = wallet(); expect(await attack((o) => { o.issuerTo = thief.tokenAddress; })).toFailRequireWith('issuer must be recreated'); });
  it('rejects taking stamps while reporting none taken', async () => { expect(await attack((o) => { o.issuerStamps += 5n; })).toFailRequireWith('no stamps taken'); });

  it('rejects an issuer that is not input 0', async () => {
    const w = await world();
    const [issuerUtxo] = await w.issuer.getUtxos();
    const coin = w.fund();
    const tx = new TransactionBuilder({ provider: w.provider })
      .addInput(coin.utxo, coin.unlocker)
      .addInput(issuerUtxo, w.issuer.unlock.earn())
      .addOutput({ to: w.issuer.tokenAddress, amount: issuerUtxo.satoshis + 50n, token: { category: w.shop.category, amount: issuerUtxo.token!.amount - 5n } })
      .addOutput({ to: w.merchant.lock, amount: 4_950n })
      .addOutput({ to: w.customer.tokenAddress, amount: 1000n, token: { category: w.shop.category, amount: 5n } });
    expect(tx).toFailRequireWith('issuer must be input 0');
  });
});

describe('StampIssuer.collect and withdraw', () => {
  const fatIssuer = async () => {
    const w = await world();
    const [small] = await w.issuer.getUtxos();
    // Stand in for an issuer output that has accrued 24,000 sats of protocol fees.
    const issuerUtxo = w.provider.addUtxo(w.issuer.tokenAddress, randomUtxo({ satoshis: 25_000n, token: small.token }));
    return { ...w, issuerUtxo };
  };

  it('lets anyone forward accrued fees to the protocol treasury', async () => {
    const w = await fatIssuer();
    await buildCollect({ ...w }).builder.send();
    const got = (await w.provider.getUtxos(w.treasury.address)).reduce((s, u) => s + u.satoshis, 0n);
    expect(got).toBeGreaterThan(23_000n);
  });

  it('will not send fees anywhere else, and waits until enough has accrued', async () => {
    const w = await fatIssuer();
    const thief = wallet();
    const steal = new TransactionBuilder({ provider: w.provider })
      .addInput(w.issuerUtxo, w.issuer.unlock.collect())
      .addOutput({ to: w.issuer.tokenAddress, amount: 1000n, token: w.issuerUtxo.token })
      .addOutput({ to: thief.address, amount: 23_500n });
    expect(steal).toFailRequireWith('output 1 must pay the protocol');
    const [small] = (await w.issuer.getUtxos()).filter((u) => u.satoshis === 1000n);
    const payer = w.fund(5000n); // covers the network fee, so only the covenant can object
    const early = new TransactionBuilder({ provider: w.provider })
      .addInput(small, w.issuer.unlock.collect())
      .addInput(payer.utxo, payer.unlocker)
      .addOutput({ to: w.issuer.tokenAddress, amount: 1000n, token: small.token })
      .addOutput({ to: w.treasury.address, amount: 4000n });
    expect(early).toFailRequireWith('not enough fees accrued');
  });

  it('lets the shop reclaim unissued stamps but not the accrued fees', async () => {
    const w = await fatIssuer();
    const unlock = w.issuer.unlock.withdraw(w.merchant.pub, w.merchant.sig);
    const keepFees = new TransactionBuilder({ provider: w.provider })
      .addInput(w.issuerUtxo, unlock)
      .addOutput({ to: w.merchant.tokenAddress, amount: 24_000n, token: w.issuerUtxo.token });
    expect(keepFees).toFailRequireWith('output 0 must pay the protocol');
    const honest = new TransactionBuilder({ provider: w.provider })
      .addInput(w.issuerUtxo, unlock)
      .addOutput({ to: w.treasury.address, amount: 23_000n })
      .addOutput({ to: w.merchant.tokenAddress, amount: 1000n, token: w.issuerUtxo.token });
    await expect(honest.send()).resolves.toBeDefined();
  });

  it('refuses a withdrawal signed by anyone else', async () => {
    const w = await fatIssuer();
    const tx = new TransactionBuilder({ provider: w.provider })
      .addInput(w.issuerUtxo, w.issuer.unlock.withdraw(w.customer.pub, w.customer.sig))
      .addOutput({ to: w.treasury.address, amount: 23_000n })
      .addOutput({ to: w.customer.tokenAddress, amount: 1000n, token: w.issuerUtxo.token });
    expect(tx).toFailRequireWith('not the shop');
  });
});

describe('RewardReserve', () => {
  const redeemArgs = async (w: Awaited<ReturnType<typeof world>>) => {
    const [reserveUtxo] = await w.reserve.getUtxos();
    const stampInputs = (await w.stampsOf(w.customer.address)).map((utxo) => ({ utxo, unlocker: w.customer.sig.unlockP2PKH() }));
    return { shop: w.shop, reserveUtxo, stampInputs, customerAddress: w.customer.address, customerTokenAddress: w.customer.tokenAddress, provider: w.provider };
  };

  it('pays the redeem rate for stamps earned by paying the shop', async () => {
    const w = await world();
    await w.earn(20_000n);
    const { builder, plan } = buildRedeem({ ...(await redeemArgs(w)), stamps: 20n });
    await builder.send();
    expect(plan.reward).toBe(600n);
    expect(plan.payout).toBe(1000n + 600n - plan.fee);
    const [after] = await w.reserve.getUtxos();
    expect(after.satoshis).toBe(99_400n);
    expect(after.token).toMatchObject({ category: w.shop.category, amount: 20n });
    expect(await w.stampsOf(w.customer.address)).toHaveLength(0);
  });

  it('combines stamps from several payments and returns stamp change', async () => {
    const w = await world();
    await w.earn(30_000n);
    await w.earn(20_000n);
    const { builder, plan } = buildRedeem({ ...(await redeemArgs(w)), stamps: 45n });
    await builder.send();
    expect(plan.stampChange).toBe(5n);
    expect((await w.stampsOf(w.customer.address)).map((u) => u.token!.amount)).toEqual([5n]);
    expect((await w.reserve.getUtxos())[0].satoshis).toBe(100_000n - 45n * 30n);
  });

  const cheat = async (build: (w: Awaited<ReturnType<typeof world>>, reserveUtxo: SpendableUtxo, stamp: SpendableUtxo) => TransactionBuilder) => {
    const w = await world();
    await w.earn(10_000n);
    const [reserveUtxo] = await w.reserve.getUtxos();
    const [stamp] = await w.stampsOf(w.customer.address);
    return build(w, reserveUtxo, stamp);
  };
  const base = (w: Awaited<ReturnType<typeof world>>, r: SpendableUtxo, s: SpendableUtxo) =>
    new TransactionBuilder({ provider: w.provider, allowImplicitFungibleTokenBurn: true }).addInput(r, w.reserve.unlock.redeem()).addInput(s, w.customer.sig.unlockP2PKH());

  it('rejects taking more than the stamps are worth', async () => {
    expect(await cheat((w, r, s) => base(w, r, s)
      .addOutput({ to: w.reserve.tokenAddress, amount: r.satoshis - 301n, token: { category: w.shop.category, amount: 10n } })
      .addOutput({ to: w.customer.address, amount: 800n }))).toFailRequireWith('payout exceeds stamps handed in');
  });
  it('rejects a payout with no stamps handed in', async () => {
    expect(await cheat((w, r, s) => base(w, r, s)
      .addOutput({ to: w.customer.tokenAddress, amount: 1000n, token: s.token })
      .addOutput({ to: w.reserve.address, amount: r.satoshis - 600n }))).toFailRequireWith('reserve must be recreated');
  });
  it('rejects tokens from another shop', async () => {
    const w = await world();
    const [reserveUtxo] = await w.reserve.getUtxos();
    const foreign = w.provider.addUtxo(w.customer.tokenAddress, randomUtxo({ satoshis: 1000n, token: { category: OTHER, amount: 10n } }));
    const tx = base(w, reserveUtxo, foreign)
      .addOutput({ to: w.reserve.tokenAddress, amount: reserveUtxo.satoshis - 300n, token: { category: OTHER, amount: 10n } })
      .addOutput({ to: w.customer.address, amount: 800n });
    expect(tx).toFailRequireWith("reserve output must hold this merchant's stamps");
  });
  it('rejects sending the reserve somewhere else', async () => {
    expect(await cheat((w, r, s) => base(w, r, s)
      .addOutput({ to: w.customer.tokenAddress, amount: r.satoshis - 300n, token: { category: w.shop.category, amount: 10n } })
      .addOutput({ to: w.customer.address, amount: 800n }))).toFailRequireWith('reserve must be recreated at the same index');
  });
  it('lets only the shop close the reserve', async () => {
    const w = await world();
    const [reserveUtxo] = await w.reserve.getUtxos();
    const by = (who: ReturnType<typeof wallet>) => new TransactionBuilder({ provider: w.provider })
      .addInput(reserveUtxo, w.reserve.unlock.withdraw(who.pub, who.sig)).addOutput({ to: who.address, amount: 99_000n });
    expect(by(w.customer)).toFailRequireWith('not the merchant');
    await expect(by(w.merchant).send()).resolves.toBeDefined();
  });
});

describe('closing a shop', () => {
  it('returns the reserve, forwards accrued fees and burns every stamp the shop holds', async () => {
    const w = await world({ issuerOutputs: 3 });
    await w.earn(20_000n);
    const { builder: redeem } = buildRedeem({ ...(await (async () => {
      const [reserveUtxo] = await w.reserve.getUtxos();
      const stampInputs = (await w.stampsOf(w.customer.address)).map((utxo) => ({ utxo, unlocker: w.customer.sig.unlockP2PKH() }));
      return { shop: w.shop, reserveUtxo, stampInputs, customerAddress: w.customer.address, customerTokenAddress: w.customer.tokenAddress, provider: w.provider };
    })()), stamps: 20n });
    await redeem.send();
    // One issuer output has accrued fees past the threshold.
    const [first] = await w.issuer.getUtxos();
    w.provider.addUtxo(w.issuer.tokenAddress, randomUtxo({ satoshis: 9_000n, token: { category: w.shop.category, amount: 50n } }));
    const issuers = await w.issuer.getUtxos();
    const reserves = await w.reserve.getUtxos();
    const before = (await w.provider.getUtxos(w.merchant.address)).reduce((s, u) => s + u.satoshis, 0n);
    const { builders, plan } = buildCloseShop({
      shop: w.shop, protocol: w.protocol, issuers, reserves, merchantPk: w.merchant.pub, merchantSig: w.merchant.sig,
      merchantAddress: w.merchant.address, provider: w.provider,
    });
    expect(builders).toHaveLength(issuers.length);
    for (const b of builders) await b.send();
    expect(await w.issuer.getUtxos()).toHaveLength(0);
    expect(await w.reserve.getUtxos()).toHaveLength(0);
    expect(plan.burned).toBe(issuers.reduce((s, u) => s + u.token!.amount, 0n) + 20n);
    expect(plan.protocolFees).toBe(7_000n);
    const after = (await w.provider.getUtxos(w.merchant.address)).reduce((s, u) => s + u.satoshis, 0n);
    expect(after - before).toBe(plan.returned);
    expect(plan.returned).toBeGreaterThan(99_000n);
    expect((await w.provider.getUtxos(w.merchant.tokenAddress)).some((u) => u.token)).toBe(false);
    void first;
  });

  it('cannot be signed by anyone but the shop', async () => {
    const w = await world();
    const { builders } = buildCloseShop({
      shop: w.shop, protocol: w.protocol, issuers: await w.issuer.getUtxos(), reserves: await w.reserve.getUtxos(),
      merchantPk: w.customer.pub, merchantSig: w.customer.sig, merchantAddress: w.customer.address, provider: w.provider,
    });
    expect(builders[0]).toFailRequireWith('not the shop');
  });
});

describe('shop links', () => {
  it('round-trips a shop and rejects malformed paths', () => {
    const shop: Shop = { name: 'Café & Co / 2', category: 'ab'.repeat(32), merchantPkh: 'cd'.repeat(20), earn: 1000n, redeem: 30n };
    expect(parseShopPath(shopPath(shop))).toEqual(shop);
    expect(parseShopPath('/s/x/zz/cd/1000/30')).toBeUndefined();
    expect(parseShopPath(`/s/x/${'ab'.repeat(32)}/${'cd'.repeat(20)}/0/30`)).toBeUndefined();
    expect(parseShopPath('/new')).toBeUndefined();
  });
});
