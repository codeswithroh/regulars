import { useState } from 'react';
import { Gift, Stamp, Wallet as WalletIcon, X, Check } from 'lucide-react';

const KEY = 'regulars-hint-dismissed';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/**
 * A three-step guide shown above the pay page until it is dismissed: connect, pay, redeem.
 * The current step lights up as the visitor goes, so a first-timer always knows the next move.
 */
export function FirstVisitHint({ connected, stamps }: { connected: boolean; stamps: bigint }) {
  const [hidden, setHidden] = useState(read);
  if (hidden) return null;
  const current = !connected ? 0 : stamps === 0n ? 1 : 2;
  const steps = [
    { icon: WalletIcon, label: 'Connect', sub: 'any WizardConnect wallet' },
    { icon: Stamp, label: 'Pay', sub: 'stamps arrive instantly' },
    { icon: Gift, label: 'Redeem', sub: 'BCH back from the reserve' },
  ];
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* private window */ } };
  return (
    <section className="hint-bar fade-in" aria-label="How to use this page">
      <ol>
        {steps.map(({ icon: Icon, label, sub }, i) => (
          <li key={label} className={i < current ? 'done' : i === current ? 'now' : ''}>
            <span className="h-ico">{i < current ? <Check size={16} /> : <Icon size={16} />}</span>
            <span><b>{label}</b><small>{sub}</small></span>
          </li>
        ))}
      </ol>
      <button className="h-close" onClick={dismiss} aria-label="Dismiss tips"><X size={16} /></button>
    </section>
  );
}
