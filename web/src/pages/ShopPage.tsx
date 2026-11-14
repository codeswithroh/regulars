import { useState } from 'react';
import { shopPath, type Shop } from '@regulars/contracts';
import { protocol } from '../config';
import { payAndEarn, readShop, readWallet, redeemStamps, stampsHeld } from '../wallet';
import { NoticeBar, PunchCard, cashbackPercent, go, sats, useAction, useLive } from '../ui';

const QUICK = [2n, 5n, 10n];

export function ShopPage({ shop }: { shop: Shop }) {
  const { state, wallet, manager, refresh, error } = useLive(shop);
  const { notice, run, busy } = useAction(refresh);
  const [custom, setCustom] = useState('');
  const stamps = stampsHeld(wallet, shop);
  const ready = Boolean(manager && wallet && state);

  // Each action re-reads the chain first: spending from a cached coin list would conflict
  // with a transaction sent a moment ago.
  const pay = (amount: bigint) => run('Approve the payment in your wallet…', async () => {
    const [freshWallet, freshShop] = await Promise.all([readWallet(manager!), readShop(shop)]);
    const { txid, plan } = await payAndEarn(manager!, freshWallet, shop, freshShop, amount);
    return { kind: 'ok', text: `Paid ${sats(amount)} and earned ${plan.stamps} stamps in the same transaction.`, txid };
  });

  const redeem = () => run('Approve the redemption in your wallet…', async () => {
    const [freshWallet, freshShop] = await Promise.all([readWallet(manager!), readShop(shop)]);
    const { txid, plan } = await redeemStamps(manager!, freshWallet, shop, freshShop);
    return { kind: 'ok', text: `Redeemed ${plan.stamps} stamps for ${sats(plan.payout)}.`, txid };
  });

  const customAmount = /^\d{1,9}$/.test(custom) ? BigInt(custom) : 0n;

  return (
    <>
      <section className="hero compact">
        <p className="eyebrow">Regulars shop</p>
        <h1>{shop.name}</h1>
        <p className="lede">Pay in Bitcoin Cash and get <strong>{cashbackPercent(shop)}% back</strong>. One stamp per {sats(shop.earn)}; each stamp redeems for {sats(shop.redeem)}.</p>
      </section>

      <section className="grid">
        <div className="card">
          <h2>1. Pay {shop.name}</h2>
          <div className="row">
            {QUICK.map((multiple) => {
              const amount = multiple * shop.earn;
              return <button key={String(multiple)} disabled={!ready || busy} onClick={() => pay(amount)}>{sats(amount)}</button>;
            })}
          </div>
          <form className="row custom" onSubmit={(e) => { e.preventDefault(); if (customAmount >= shop.earn) pay(customAmount); }}>
            <input inputMode="numeric" placeholder="Other amount in sats" aria-label="Other amount in sats" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} />
            <button className="ghost" disabled={!ready || busy || customAmount < shop.earn}>Pay</button>
          </form>
          {manager && wallet && <p className="muted" data-testid="balance">Wallet balance: {sats(wallet.bch)}</p>}
          {!manager && <p className="muted">Connect a wallet to pay.</p>}
          <p className="fine">Your wallet also sends 1,000 sats along with your stamps; you get it back when you redeem. The shop receives your payment minus a {Number(protocol.feePerStamp * 1000n / shop.earn) / 10}% protocol fee.</p>
        </div>

        <div className="card">
          <h2>2. Your stamps</h2>
          <div className="big" data-testid="stamps">{stamps.toLocaleString('en-US')}</div>
          <PunchCard stamps={stamps} />
          <p className="muted">Worth {sats(stamps * shop.redeem)} from the reserve.</p>
          <button disabled={!ready || stamps === 0n || busy || !state?.reserveUtxo} onClick={redeem}>Redeem for BCH</button>
        </div>

        <div className="card">
          <h2>Reward reserve</h2>
          <div className="big" data-testid="reserve">{state ? sats(state.reserve) : '…'}</div>
          <p className="muted">Locked in a contract. It pays {sats(shop.redeem)} per stamp to anyone who hands stamps in, and the shop cannot stop a redemption.</p>
          <p className="fine">{state ? `${state.stampsLeft.toLocaleString('en-US')} stamps left to earn · ${state.redeemed.toLocaleString('en-US')} redeemed so far` : ' '}</p>
        </div>
      </section>

      <NoticeBar notice={notice} />
      {error && <p className="notice error">{error}</p>}
      {state && state.issuers.length === 0 && <p className="notice error">No shop was found at this link on this network. Check the link is complete.</p>}
      <p className="fine center"><a href={`#/poster${shopPath(shop).slice(2)}`} onClick={(e) => { e.preventDefault(); go(`/poster${shopPath(shop).slice(2)}`); }}>Printable poster for this shop</a></p>
    </>
  );
}
