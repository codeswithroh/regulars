import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CreditCard, Gift, ShieldCheck, Stamp, Store, Wallet as WalletIcon, QrCode, BarChart3 } from 'lucide-react';
import { shopPath, type Shop } from '@regulars/contracts';
import { protocol } from '../config';
import { payAndEarn, previewEarn, previewRedeem, readShop, readWallet, redeemStamps } from '../wallet';
import { Ring } from '../components/charts';
import { Avatar, CountUp, LoyaltyCard, Toast, fmt, sats } from '../components/kit';
import { FirstVisitHint } from '../components/FirstVisitHint';
import { rememberShop, stampsOf, useAction, useShopState, useWallet, useWalletConnection } from '../ui';
import { MerchantBadge } from '../identity/MerchantBadge';

// Stamps per preset. At demo sizes the 1 sat/byte network fee is a real share of the cashback,
// so presets start at 10 stamps to keep a redemption worth more than its fee.
const PRESETS = [10n, 25n, 50n];

export function ShopPay({ shop }: { shop: Shop }) {
  const wc = useWalletConnection();
  const { wallet, manager, refresh: refreshWallet } = useWallet();
  const { state, refresh: refreshShop, error } = useShopState(shop);
  const { notice, run, busy, clear } = useAction(() => Promise.all([refreshWallet(), refreshShop()]));
  const [tab, setTab] = useState<'pay' | 'redeem'>('pay');
  const [amount, setAmount] = useState<bigint>(PRESETS[1] * shop.earn);
  const [custom, setCustom] = useState('');
  const [justEarned, setJustEarned] = useState(false);
  useEffect(() => rememberShop(shop), [shop]);

  const stamps = stampsOf(wallet, shop);
  const pay = custom ? (/^\d{1,9}$/.test(custom) ? BigInt(custom) : 0n) : amount;
  const earned = pay / shop.earn;
  const fee = earned * protocol.feePerStamp;
  const ready = Boolean(manager && wallet && state);
  const percent = Number((shop.redeem * 10000n) / shop.earn) / 100;
  const coverage = state && state.reserve > 0n ? Number(state.reserve / shop.redeem) : 0;
  // Exact figures from the transaction that would be built (no wallet request involved).
  const earnPreview = wallet && state && earned > 0n ? previewEarn(wallet, shop, state, pay) : undefined;
  const redeemPreview = wallet && state && stamps > 0n ? previewRedeem(wallet, shop, state) : undefined;
  const missingShop = state && state.issuers.length === 0;

  const doPay = () => run('Approve the payment in your wallet…', async () => {
    const [w, s] = await Promise.all([readWallet(manager!), readShop(shop)]);
    const { txid, plan } = await payAndEarn(manager!, w, shop, s, pay);
    setJustEarned(true); setTimeout(() => setJustEarned(false), 2400);
    return { kind: 'ok', text: `Paid ${sats(pay)} and earned ${plan.stamps} stamps in the same transaction.`, txid };
  });
  const doRedeem = () => run('Approve the redemption in your wallet…', async () => {
    const [w, s] = await Promise.all([readWallet(manager!), readShop(shop)]);
    const { txid, plan } = await redeemStamps(manager!, w, shop, s);
    return { kind: 'ok', text: `Redeemed ${plan.stamps} stamps for ${sats(plan.payout)}.`, txid };
  });

  const steps = useMemo(() => [
    { label: 'Pay', icon: CreditCard, state: stamps > 0n ? 'done' : 'on' },
    { label: 'Earn', icon: Stamp, state: stamps > 0n ? 'done' : '' },
    { label: 'Redeem', icon: Gift, state: stamps > 0n ? 'on' : '' },
  ], [stamps]);

  return (
    <>
      <FirstVisitHint connected={Boolean(manager)} stamps={stamps} />
      <section className="pay fade-in">
        <div className="pay-main">
          <div className="pay-head">
            <Avatar seed={shop.category} size={48} label={shop.name} />
            <div style={{ minWidth: 0 }}>
              <h1>{shop.name}</h1>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <span className="pill accent">{percent}% back</span>
                <MerchantBadge shop={shop} />
              </div>
            </div>
            <div className="lock">
              <ShieldCheck size={18} style={{ color: 'var(--good)', flex: 'none' }} />
              <span><b>Reserve locked</b><span data-testid="reserve">{state ? sats(state.reserve) : '…'}</span></span>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'pay'} className={tab === 'pay' ? 'on' : ''} onClick={() => setTab('pay')}><CreditCard size={16} />Pay</button>
            <button role="tab" aria-selected={tab === 'redeem'} className={tab === 'redeem' ? 'on' : ''} onClick={() => setTab('redeem')}>
              <Gift size={16} />Redeem{stamps > 0n && <span className="badge num">{fmt(stamps)}</span>}
            </button>
          </div>

          {tab === 'pay' ? (
            <div className="pay-grid">
              <div style={{ display: 'grid', gap: 12, transform: justEarned ? 'scale(1.03)' : undefined, transition: 'transform .4s' }}>
                <LoyaltyCard name={shop.name} category={shop.category} stamps={stamps} testId="card" />
                <div className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Stamp size={14} />Stamps: <b data-testid="stamps" className="num" style={{ color: 'var(--ink)' }}>{fmt(stamps)}</b>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="amounts" role="radiogroup" aria-label="Amount">
                  {PRESETS.map((m) => {
                    const a = m * shop.earn;
                    const on = !custom && amount === a;
                    return (
                      <button key={String(m)} role="radio" aria-checked={on} className={`amount${on ? ' on' : ''}`} onClick={() => { setCustom(''); setAmount(a); }}>
                        <span className="a-dot" />{fmt(a)} sats<span className="a-earn">+{fmt(m)}</span>
                      </button>
                    );
                  })}
                </div>
                <input className="input num" inputMode="numeric" placeholder="Other amount in sats" aria-label="Other amount in sats" value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} />
                {manager && wallet && <span className="muted" style={{ fontSize: 13 }} data-testid="balance">Balance {sats(wallet.bch)}</span>}
                {manager
                  ? <button className="btn lg block" disabled={!ready || busy || earned < 1n || missingShop} onClick={doPay}>Pay {fmt(pay)} sats</button>
                  : <button className="btn lg block accent" onClick={() => wc.connect()} disabled={wc.state === 'connecting'}><WalletIcon size={18} />Connect wallet</button>}
              </div>
            </div>
          ) : (
            <div className="redeem-panel">
              <div className="big-count num" data-testid="stamps"><CountUp value={Number(stamps)} /></div>
              <LoyaltyCard name={shop.name} category={shop.category} stamps={stamps} size="sm" tilt={false} />
              <div className="summary" style={{ width: '100%', maxWidth: 360, background: '#f7f7f8' }} data-testid="redeem-breakdown">
                <div className="sum-row"><span>Cashback</span><b className="num plus">+{sats(stamps * shop.redeem)}</b></div>
                <div className="sum-row"><span>Deposit back</span><b className="num">{redeemPreview ? '+' + sats(redeemPreview.deposit) : '…'}</b></div>
                <div className="sum-row"><span>Network fee</span><b className="num">−{redeemPreview ? sats(redeemPreview.fee) : '…'}</b></div>
                <div className="sum-row"><span>You receive</span><b className="num">{redeemPreview ? sats(redeemPreview.payout) : '…'}</b></div>
              </div>
              {redeemPreview && redeemPreview.reward < redeemPreview.fee && (
                <p className="pill warn" style={{ padding: '8px 12px', borderRadius: 10, margin: 0 }} data-testid="fee-warning">
                  <AlertTriangle size={14} />The network fee is more than this cashback. Collect a few more stamps first.
                </p>
              )}
              {manager
                ? <button className="btn lg accent" disabled={!ready || stamps === 0n || busy || !state?.reserveUtxo} onClick={doRedeem}><Gift size={18} />Redeem {fmt(stamps)} stamps</button>
                : <button className="btn lg accent" onClick={() => wc.connect()}><WalletIcon size={18} />Connect wallet</button>}
            </div>
          )}
        </div>

        <aside className="pay-side">
          <div className="steps" aria-label="Progress">
            {steps.map(({ label, icon: Icon, state: s }) => (
              <div key={label} className={`step ${s}`}><i><Icon size={17} /></i>{label}</div>
            ))}
          </div>
          <div className="summary">
            <div className="sum-row"><span>You pay</span><b className="num">{sats(pay)}</b></div>
            <div className="sum-row"><span>Shop receives</span><b className="num">{sats(pay - fee)}</b></div>
            <div className="sum-row"><span>Protocol fee</span><b className="num">{sats(fee)}</b></div>
            <div className="sum-row"><span>Network fee</span><b className="num">{earnPreview ? sats(earnPreview.fee) : '≈ 700 sats'}</b></div>
            <div className="sum-row"><span>Stamp deposit <small className="muted">· back when you redeem</small></span><b className="num">1,000 sats</b></div>
            <div className="sum-row"><span>Cashback value</span><b className="num">{sats(earned * shop.redeem)}</b></div>
          </div>
          <div className="total"><span>You earn</span><b className="num">+{fmt(earned)} <Stamp size={20} style={{ display: 'inline', verticalAlign: '-3px' }} /></b></div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, boxShadow: 'none' }}>
            <Ring value={state ? Math.min(1, coverage / 10000) : 0} size={92} stroke={10} color="var(--accent)">
              <b style={{ fontSize: 16 }}>{state ? `${Math.min(100, Math.round((coverage / 10000) * 100))}%` : '…'}</b>
            </Ring>
            <div style={{ display: 'grid', gap: 4 }}>
              <b style={{ fontSize: 15 }} className="num">{fmt(coverage)} stamps</b>
              <span className="muted" style={{ fontSize: 13 }}>covered · {state ? `${fmt(state.stampsLeft)} left` : '…'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a className="btn ghost" href={`#/poster${shopPath(shop).slice(2)}`}><QrCode size={16} />Poster</a>
            <a className="btn ghost" href={`#/app/manage${shopPath(shop)}`}><BarChart3 size={16} />Analytics</a>
          </div>
        </aside>
      </section>
      {(error || missingShop) && (
        <p className="notice error" style={{ animation: 'none' }}><Store size={18} />{missingShop ? 'This shop is not taking payments. It may have been closed by its owner, or the link is incomplete or for another network.' : `Could not read the chain: ${error}`}</p>
      )}
      <Toast notice={notice} onClose={clear} />
    </>
  );
}
