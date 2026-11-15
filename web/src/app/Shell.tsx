import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, BadgeCheck, Fingerprint, LogIn, BarChart3, ChevronsUpDown, ExternalLink, Home, LayoutGrid, LogOut, Plus, Store, Wallet } from 'lucide-react';
import { Banner } from '../components/Banner';
import { network } from '../config';
import { Avatar, shortAddr } from '../components/kit';
import { Logo } from '../components/Logo';
import { useKnownShops, useWallet, useWalletConnection } from '../ui';

import type { AppPage as Page } from '../route';
const TITLES: Record<Page, string> = { overview: 'Overview', shop: 'Pay', shops: 'Shops', activity: 'Activity', manage: 'Analytics', new: 'Open a shop', identity: 'Identity', lookup: 'Verify an identity', missing: 'Not found' };

const NAV = [
  { group: 'Main', items: [
    { page: 'overview', href: '#/app', label: 'Overview', icon: LayoutGrid },
    { page: 'shops', href: '#/app/shops', label: 'Shops', icon: Store },
    { page: 'activity', href: '#/app/activity', label: 'Activity', icon: ArrowLeftRight },
  ] },
  { group: 'Merchant', items: [
    { page: 'manage', href: '#/app/manage', label: 'Analytics', icon: BarChart3 },
    { page: 'new', href: '#/app/new', label: 'Open a shop', icon: Plus },
  ] },
  { group: 'Identity', items: [
    { page: 'identity', href: '#/app/identity', label: 'My identity', icon: Fingerprint },
    { page: 'lookup', href: '#/app/id', label: 'Verify', icon: BadgeCheck },
    { page: 'signin', href: '#/signin-demo', label: 'Sign-in demo', icon: LogIn },
  ] },
] as const;

function WalletButton({ compact = false }: { compact?: boolean }) {
  const wc = useWalletConnection();
  const { wallet, manager } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const address = wallet?.utxos[0]?.address ?? '';
  if (wc.state !== 'connected' || !manager) {
    return <button className="btn" onClick={() => wc.connect()} disabled={wc.state === 'connecting'}><Wallet size={16} />Connect wallet</button>;
  }
  const name = wc.walletName ?? 'Wallet';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {compact
        ? <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-label={`${name} · Disconnect`}><Avatar seed={name} size={22} />{name}</button>
        : (
          <button className="who" onClick={() => setOpen((o) => !o)} aria-label={`${name} · Disconnect`}>
            <Avatar seed={name + address} size={36} label={name} />
            <span><b>{name}</b><small>{address ? shortAddr(address) : 'Connected'}</small></span>
            <ChevronsUpDown size={16} />
          </button>
        )}
      {open && (
        <div className="menu" style={compact ? { right: 0, top: 48 } : { left: 0, bottom: 64 }}>
          <button onClick={() => { setOpen(false); wc.disconnect(); }}><LogOut size={16} />Disconnect</button>
        </div>
      )}
    </div>
  );
}

export function Shell({ page, children }: { page: Page; children: ReactNode }) {
  const { primary } = useWallet();
  const { mine } = useKnownShops(primary);
  const active = page === 'shop' ? 'shops' : page;
  return (
    <div className="app">
      <Banner />
      <div className="shell">
        <aside className="side">
          <a className="brand" href="#/"><Logo size={34} />Regulars</a>
          {NAV.map((g) => (
            <nav key={g.group} aria-label={g.group}>
              <div className="side-label">{g.group}</div>
              {g.items.map(({ page: p, href, label, icon: Icon }) => (
                <a key={p} href={href} className={`nav-item${active === p ? ' on' : ''}`} aria-current={active === p ? 'page' : undefined}>
                  <Icon size={18} />{label}
                  {p === 'manage' && mine.length > 0 && <span className="count">{mine.length}</span>}
                </a>
              ))}
            </nav>
          ))}
          <div className="side-foot">
            <a className="nav-item" href="#/"><Home size={18} />About<ExternalLink size={14} style={{ marginLeft: 'auto', opacity: .5 }} /></a>
            <span className="net"><i />{network === 'mainnet' ? 'Mainnet' : 'Chipnet'}</span>
            <SideWallet />
          </div>
        </aside>
        <div className="main">
          <header className="top">
            {page === 'shop' ? <div className="top-title">{TITLES[page]}</div> : <h1>{TITLES[page]}</h1>}
            <span className="spacer" />
            <div className="top-wallet"><TopWallet /></div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
      <nav className="tabbar" aria-label="Sections">
        {[...NAV[0].items, NAV[1].items[0]].map(({ page: p, href, label, icon: Icon }) => (
          <a key={p} href={href} className={active === p ? 'on' : ''}><Icon size={20} />{label}</a>
        ))}
      </nav>
    </div>
  );
}

/** The sidebar shows who is connected; connecting happens from the top bar, so there is one button. */
function SideWallet() {
  const wc = useWalletConnection();
  return wc.state === 'connected' ? <WalletButton /> : null;
}

/** Top bar: the connect button, or the wallet control where the sidebar is hidden. */
function TopWallet() {
  const wc = useWalletConnection();
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 860px)').matches);
  useEffect(() => {
    const m = matchMedia('(max-width: 860px)');
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  if (wc.state === 'connected' && !narrow) return null;
  return <WalletButton compact />;
}
