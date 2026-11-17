import { useState } from 'react';
import { DoorClosed } from 'lucide-react';
import type { Shop } from '@regulars/contracts';
import { closeShop, previewClose, type ShopState } from '../wallet';
import { fmt, sats } from '../components/kit';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { Notice } from '../components/kit';

/**
 * The shop owner's way out: take the reward reserve back and retire the unissued stamps. It is
 * irreversible, so the card spells out what happens to customers and asks for the shop's name.
 */
export function CloseShop({ shop, state, held, manager, busy, run }: {
  shop: Shop;
  state: ShopState;
  /** Stamps customers still hold, which can no longer be redeemed once the reserve is gone. */
  held: bigint;
  manager: DappConnectionManager;
  busy: boolean;
  run: (busy: string, work: (say: (n: Notice) => void) => Promise<Notice>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const plan = previewClose(shop, state);
  if (!plan) return null;
  const confirmed = typed.trim() === shop.name;

  const close = () => run(`Closing ${shop.name}…`, async (say) => {
    const { txids, plan: done } = await closeShop(manager, shop, state, (text) => say({ kind: 'busy', text }));
    setOpen(false); setTyped('');
    return { kind: 'ok', text: `${shop.name} is closed. ${sats(done.returned)} came back to your wallet.`, txid: txids[0] };
  });

  return (
    <section className="card fade-in" data-testid="close-shop" style={{ display: 'grid', gap: 14, borderColor: 'var(--bad-soft)' }}>
      <div className="card-head" style={{ margin: 0 }}>
        <h2>Close this shop</h2><span className="spacer" />
        {!open && <button className="btn ghost" onClick={() => setOpen(true)}><DoorClosed size={16} />Close shop…</button>}
      </div>
      {!open ? (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Takes the reward reserve back to your wallet and retires the stamps you have not given out. Only your wallet can do this.</p>
      ) : (
        <>
          <div className="summary">
            <div className="sum-row"><span>Back to your wallet</span><b className="num">{sats(plan.returned)}</b></div>
            <div className="sum-row"><span>Unissued stamps destroyed</span><b className="num">{fmt(plan.burned)}</b></div>
            {plan.protocolFees > 0n && <div className="sum-row"><span>Accrued protocol fees forwarded</span><b className="num">{sats(plan.protocolFees)}</b></div>}
            <div className="sum-row"><span>Network fees</span><b className="num">{sats(plan.fee)}</b></div>
            <div className="sum-row"><span>Wallet approvals</span><b className="num">{plan.approvals}</b></div>
          </div>
          {held > 0n && (
            <p className="notice error" style={{ animation: 'none', margin: 0 }} data-testid="close-warning">
              Customers still hold {fmt(held)} stamps, worth {sats(held * shop.redeem)}. After closing they can no longer redeem them. Consider telling your regulars first.
            </p>
          )}
          <label className="field">Type <b>{shop.name}</b> to confirm
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Shop name to confirm" autoComplete="off" />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }} disabled={!confirmed || busy} onClick={close}><DoorClosed size={16} />Close shop</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setOpen(false); setTyped(''); }}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
