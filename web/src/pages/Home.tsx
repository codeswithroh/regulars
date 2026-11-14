import { shopPath } from '@regulars/contracts';
import { demoShop } from '../config';
import { cashbackPercent, sats, useLive, go } from '../ui';

export function Home() {
  const { state } = useLive(demoShop);
  return (
    <>
      <section className="hero">
        <p className="eyebrow">A loyalty protocol on Bitcoin Cash</p>
        <h1>Loyalty points that are <em>real money</em>.</h1>
        <p className="lede">Customers pay a shop in BCH and get stamps in the same transaction. Stamps are redeemable for BCH from a reserve the shop locks up front. No accounts, no server, no way for the shop to back out.</p>
        <div className="row">
          {demoShop && <button onClick={() => go(shopPath(demoShop!))}>Try the demo shop</button>}
          <button className="ghost" onClick={() => go('/new')}>Open your own shop</button>
        </div>
      </section>

      {demoShop && (
        <section className="card feature" data-testid="demo-shop">
          <div>
            <p className="eyebrow">Live on-chain right now</p>
            <h2>{demoShop.name}</h2>
            <p className="muted">{cashbackPercent(demoShop)}% back on every payment · 1 stamp per {sats(demoShop.earn)}</p>
          </div>
          <dl className="stats">
            <div><dt>Reward reserve</dt><dd data-testid="demo-reserve">{state ? sats(state.reserve) : '…'}</dd></div>
            <div><dt>Stamps redeemed</dt><dd>{state ? state.redeemed.toLocaleString('en-US') : '…'}</dd></div>
          </dl>
        </section>
      )}

      <section className="grid three">
        <div className="card"><span className="step">1</span><h3>Pay and earn, atomically</h3><p className="muted">The stamps sit in a contract anyone can spend from, provided the same transaction pays the shop. Your payment and your reward cannot be separated.</p></div>
        <div className="card"><span className="step">2</span><h3>Redeem against a locked reserve</h3><p className="muted">A second contract holds the shop's reward money. Hand it stamps and it releases BCH. The rate is fixed in the script.</p></div>
        <div className="card"><span className="step">3</span><h3>Open a shop in a minute</h3><p className="muted">One transaction from your own wallet mints your stamps and funds your reserve. You get a shop link and a poster to print.</p></div>
      </section>

      <section className="card plain">
        <h3>Why shops use it</h3>
        <p className="muted">Card networks take around 3% of every sale. A shop that accepts Bitcoin Cash keeps that, and Regulars lets it hand the saving to the customer as a reason to come back. The protocol takes 1% of rewarded payments, enforced by the contract itself.</p>
      </section>
    </>
  );
}
