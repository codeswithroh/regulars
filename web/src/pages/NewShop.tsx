import { useEffect, useState } from 'react';
import { shopPath, type Shop } from '@regulars/contracts';
import { openShop } from '../wallet';
import { NoticeBar, go, sats, useAction, useLive } from '../ui';

const MINE = 'regulars-my-shops';
export const myShops = (): string[] => { try { return JSON.parse(localStorage.getItem(MINE) ?? '[]'); } catch { return []; } };

export function NewShop() {
  const { wallet, manager } = useLive(undefined);
  const { notice, run, busy } = useAction();
  const [name, setName] = useState('');
  const [earn, setEarn] = useState('1000');
  const [percent, setPercent] = useState('3');
  const [reserve, setReserve] = useState('50000');
  const [opened, setOpened] = useState<Shop>();
  const [mine, setMine] = useState<string[]>([]);
  useEffect(() => setMine(myShops()), [opened]);

  const earnSats = /^\d{1,9}$/.test(earn) ? BigInt(earn) : 0n;
  const pct = Number(percent);
  const redeemSats = earnSats > 0n && pct > 0 ? BigInt(Math.floor(Number(earnSats) * pct / 100)) : 0n;
  const reserveSats = /^\d{1,12}$/.test(reserve) ? BigInt(reserve) : 0n;
  const problem =
    !name.trim() ? 'Give your shop a name.' :
    earnSats < 100n ? 'One stamp should cost at least 100 sats.' :
    !(pct > 0 && pct <= 50) ? 'Cashback must be between 0 and 50%.' :
    redeemSats < 1n ? 'That cashback rounds to zero sats per stamp; raise it or the sats per stamp.' :
    reserveSats < 5000n ? 'Fund the reserve with at least 5,000 sats.' : undefined;

  const submit = () => run('Preparing…', async (say) => {
    const { shop, txid } = await openShop(manager!, { name: name.trim(), earn: earnSats, redeem: redeemSats, reserveSats, supply: 1_000_000n }, say);
    try { localStorage.setItem(MINE, JSON.stringify([shopPath(shop), ...myShops()].slice(0, 20))); } catch { /* private window */ }
    setOpened(shop);
    return { kind: 'ok', text: `"${shop.name}" is open.`, txid };
  });

  return (
    <>
      <section className="hero compact">
        <p className="eyebrow">For merchants</p>
        <h1>Open your shop</h1>
        <p className="lede">One transaction from your own wallet mints a million stamps into the issuing contract and locks your reward reserve. Payments go straight to your wallet's first address. Nothing is held by this site.</p>
      </section>

      {opened ? (
        <section className="card plain" data-testid="opened">
          <h2>{opened.name} is live</h2>
          <p className="muted">Share this link or print the poster. Anyone who opens it can pay you and earn stamps.</p>
          <p><code data-testid="shop-link">{`${location.origin}/#${shopPath(opened)}`}</code></p>
          <div className="row">
            <button onClick={() => go(shopPath(opened))}>Open shop page</button>
            <button className="ghost" onClick={() => go(`/poster${shopPath(opened).slice(2)}`)}>Print poster</button>
          </div>
        </section>
      ) : (
        <form className="card plain form" onSubmit={(e) => { e.preventDefault(); if (!problem && manager) submit(); }}>
          <label>Shop name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corner Coffee" /></label>
          <div className="grid">
            <label>Sats spent per stamp<input inputMode="numeric" value={earn} onChange={(e) => setEarn(e.target.value.replace(/\D/g, ''))} /></label>
            <label>Cashback %<input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ''))} /></label>
            <label>Reward reserve (sats)<input inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value.replace(/\D/g, ''))} /></label>
          </div>
          <p className="muted" data-testid="summary">
            {problem ?? `Customers earn 1 stamp per ${sats(earnSats)} and redeem each for ${sats(redeemSats)}. A ${sats(reserveSats)} reserve covers ${(reserveSats / redeemSats).toLocaleString('en-US')} stamps.`}
          </p>
          <div className="row">
            <button disabled={!manager || !wallet || busy || Boolean(problem)}>Open shop</button>
            {manager && wallet && <span className="muted" data-testid="balance">Wallet balance: {sats(wallet.bch)}</span>}
            {!manager && <span className="muted">Connect a wallet first.</span>}
          </div>
          <p className="fine">Costs: your reserve, 8,000 sats that stay inside the issuing contract, and the network fee. The reserve remains yours to withdraw.</p>
        </form>
      )}

      <NoticeBar notice={notice} />

      {mine.length > 0 && (
        <section className="card plain">
          <h3>Shops opened from this browser</h3>
          <ul className="links">{mine.map((path) => <li key={path}><a href={`#${path}`}>{decodeURIComponent(path.split('/')[2] ?? '')}</a></li>)}</ul>
        </section>
      )}
    </>
  );
}
