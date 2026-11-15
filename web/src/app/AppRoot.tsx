import { useEffect, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog, type UseWizardConnectResult } from '@wizardconnect/react';
import type { Shop } from '@regulars/contracts';
import '../styles/app.css';
import type { AppPage } from '../route';
import { WalletContext } from '../ui';
import { Shell } from './Shell';
import { Overview } from './Overview';
import { ShopPay } from './ShopPay';
import { Shops } from './Shops';
import { Activity } from './Activity';
import { Manage } from './Manage';
import { NewShop } from './NewShop';
import { IdentityPage } from '../identity/IdentityPage';
import { LookupPage } from '../identity/LookupPage';

/** The dashboard: wallet connection plus every app page. */
export function AppRoot({ page, shop, query, path }: { page: AppPage; shop?: Shop; query?: string; path: string }) {
  const wc = useResumableConnection(useWizardConnect({ dappName: 'Regulars' }));
  return (
    <WalletContext.Provider value={wc}>
      {wc.uri && wc.qrUri && <div data-testid="pairing" data-uri={wc.uri} hidden />}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog show={wc.state === 'connecting'} onClose={() => wc.disconnect()} uri={wc.uri} qrUri={wc.qrUri} title="Regulars" subtitle="Scan with a Bitcoin Cash wallet"
          theme={{ backdropColor: 'rgba(17,19,24,.55)', dialogBackground: '#ffffff', headerBackground: '#ffffff', titleColor: '#111318', subtitleColor: '#9096a1', qrForeground: '#111318' }} />
      )}
      <Shell page={page}>
        {page === 'overview' && <Overview />}
        {page === 'shop' && shop && <ShopPay shop={shop} key={path} />}
        {page === 'shops' && <Shops />}
        {page === 'activity' && <Activity />}
        {page === 'manage' && <Manage shop={shop} key={path} />}
        {page === 'new' && <NewShop />}
        {page === 'identity' && <IdentityPage />}
        {page === 'lookup' && <LookupPage query={query} />}
        {page === 'missing' && <p className="notice error" style={{ animation: 'none' }}>That link is not a valid shop. <a href="#/app">Go to the app</a></p>}
      </Shell>
    </WalletContext.Provider>
  );
}

/**
 * After a reload the hook resumes the stored session in the `connecting` state, and `connect()` refuses
 * until the wallet answers. If the wallet is closed, every Connect button would stay disabled. After a
 * short grace period the connection reads as idle, and Connect drops the old session and pairs anew.
 */
function useResumableConnection(raw: UseWizardConnectResult): UseWizardConnectResult {
  const resuming = raw.state === 'connecting' && !raw.uri;
  const [stale, setStale] = useState(false);
  const [pairNext, setPairNext] = useState(false);
  useEffect(() => {
    if (!resuming) { setStale(false); return; }
    const t = setTimeout(() => setStale(true), 6000);
    return () => clearTimeout(t);
  }, [resuming]);
  // connect() reads the state from its own render, so it runs once disconnect() has made it idle.
  useEffect(() => {
    if (pairNext && raw.state === 'idle') { setPairNext(false); raw.connect(); }
  }, [pairNext, raw.state, raw.connect]);
  if (!stale) return raw;
  return { ...raw, state: 'idle', connect: () => { setPairNext(true); void raw.disconnect(); return true; } };
}
