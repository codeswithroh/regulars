import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { BarChart3, Printer, Store, Wallet as WalletIcon } from 'lucide-react';
import { shopPath, type Shop } from '@regulars/contracts';
import { openShop } from '../wallet';
import { LoyaltyCard, Toast, fmt, sats } from '../components/kit';
import { go, rememberMine, useAction, useWallet, useWalletConnection } from '../ui';

const RESERVES = [10_000n, 50_000n, 100_000n];

export function NewShop() {
  const wc = useWalletConnection();
  const { wallet, manager } = useWallet();
  const { notice, run, busy, clear } = useAction();
  // A name typed on the landing page arrives here once.
  const [name, setName] = useState(() => { try { return sessionStorage.getItem('regulars-prefill-name') ?? ''; } catch { return ''; } });
  useEffect(() => { try { sessionStorage.removeItem('regulars-prefill-name'); } catch { /* ignore */ } }, []);
  const [earn, setEarn] = useState('1000');
  const [percent, setPercent] = useState('3');
  const [reserve, setReserve] = useState('50000');
  const [opened, setOpened] = useState<Shop>();
  const [qr, setQr] = useState('');

  const earnSats = /^\d{1,9}$/.test(earn) ? BigInt(earn) : 0n;
  const pct = Number(percent);
  const redeemSats = earnSats > 0n && pct > 0 ? BigInt(Math.floor((Number(earnSats) * pct) / 100)) : 0n;
  const reserveSats = /^\d{1,12}$/.test(reserve) ? BigInt(reserve) : 0n;
  const problem =
    !name.trim() ? 'Give your shop a name.' :
    earnSats < 100n ? 'One stamp should cost at least 100 sats.' :
    !(pct > 0 && pct <= 50) ? 'Cashback must be between 0 and 50%.' :
    redeemSats < 1n ? 'That cashback rounds to zero sats per stamp; raise it or the sats per stamp.' :
    reserveSats < 5000n ? 'Fund the reserve with at least 5,000 sats.' : undefined;
  const steps = [Boolean(name.trim()), earnSats >= 100n && redeemSats >= 1n, reserveSats >= 5000n];
  const active = steps.findIndex((s) => !s);
  const link = opened ? `${location.origin}/#${shopPath(opened)}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 360 }).then(setQr); }, [link]);

  const submit = () => run('Preparing…', async (say) => {
    const { shop, txid } = await openShop(manager!, { name: name.trim(), earn: earnSats, redeem: redeemSats, reserveSats, supply: 1_000_000n },
      (text) => say({ kind: 'busy', text }));
    rememberMine(shop);
    setOpened(shop);
    return { kind: 'ok', text: `"${shop.name}" is open.`, txid };
  });

  const fstep = (i: number) => `fstep${steps[i] ? ' done' : ''}${active === i ? ' active' : ''}`;

  return (
    <>
      <section className="pay fade-in">
        <div className="pay-main">
          {opened ? (
            <div data-testid="opened" style={{ display: 'grid', gap: 18 }}>
              <h2 style={{ margin: 0, fontSize: 28, letterSpacing: '-.03em' }}>{opened.name} is live</h2>
              <div className="code" data-testid="shop-link">{link}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn lg" onClick={() => go(shopPath(opened))}><Store size={18} />Open shop page</button>
                <button className="btn lg ghost" onClick={() => go(`/poster${shopPath(opened).slice(2)}`)}><Printer size={18} />Print poster</button>
                <button className="btn lg ghost" onClick={() => go(`/app/manage${shopPath(opened)}`)}><BarChart3 size={18} />Analytics</button>
              </div>
            </div>
          ) : (
            <form style={{ display: 'grid', gap: 18 }} onSubmit={(e) => { e.preventDefault(); if (!problem && manager) submit(); }}>
              <div className={fstep(0)}>
                <span className="n">1</span>
                <div className="f-body">
                  <h3>Details</h3>
                  <label className="field">Shop name<input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Corner Coffee" /></label>
                </div>
              </div>
              <div className={fstep(1)}>
                <span className="n">2</span>
                <div className="f-body">
                  <h3>Rewards</h3>
                  <div className="grid g-2" style={{ gap: 14 }}>
                    <label className="field">Sats spent per stamp<input className="input num" inputMode="numeric" value={earn} onChange={(e) => setEarn(e.target.value.replace(/\D/g, ''))} /></label>
                    <label className="field">Cashback %<input className="input num" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                  </div>
                  <input className="range" type="range" min="0.5" max="10" step="0.5" value={Number.isFinite(pct) ? pct : 0} aria-label="Cashback slider" onChange={(e) => setPercent(e.target.value)} />
                </div>
              </div>
              <div className={fstep(2)}>
                <span className="n">3</span>
                <div className="f-body">
                  <h3>Reserve</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {RESERVES.map((r) => <button type="button" key={String(r)} className={`amount${reserveSats === r ? ' on' : ''}`} style={{ flex: 1, minWidth: 100 }} onClick={() => setReserve(String(r))}><span className="a-dot" />{fmt(r / 1000n)}k</button>)}
                  </div>
                  <label className="field">Reward reserve (sats)<input className="input num" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value.replace(/\D/g, ''))} /></label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 48 }}>
                {manager
                  ? <button className="btn lg" disabled={!wallet || busy || Boolean(problem)}>Open shop</button>
                  : <button type="button" className="btn lg accent" onClick={() => wc.connect()}><WalletIcon size={18} />Connect wallet</button>}
                {manager && wallet && <span className="muted num" style={{ fontSize: 13 }} data-testid="balance">Balance {sats(wallet.bch)}</span>}
              </div>
            </form>
          )}
        </div>
        <aside className="pay-side">
          <LoyaltyCard name={(opened?.name ?? name.trim()) || 'Your shop'} category={opened?.category ?? 'a0'.padEnd(64, '0')} stamps={7} />
          <p className="muted" data-testid="summary" style={{ margin: 0, fontSize: 14, minHeight: 40 }}>
            {problem ?? `Customers earn 1 stamp per ${sats(earnSats)} and redeem each for ${sats(redeemSats)}. A ${sats(reserveSats)} reserve covers ${(reserveSats / redeemSats).toLocaleString('en-US')} stamps.`}
          </p>
          <div className="summary">
            <div className="sum-row"><span>Cashback</span><b className="num">{Number.isFinite(pct) ? pct : 0}%</b></div>
            <div className="sum-row"><span>Stamps minted</span><b className="num">1,000,000</b></div>
            <div className="sum-row"><span>Reserve</span><b className="num">{sats(reserveSats)}</b></div>
            <div className="sum-row"><span>Issuer outputs</span><b className="num">8,000 sats</b></div>
          </div>
          {qr && <img className="qr" src={qr} alt="QR code for the new shop" style={{ justifySelf: 'center' }} />}
        </aside>
      </section>
      <Toast notice={notice} onClose={clear} />
    </>
  );
}
