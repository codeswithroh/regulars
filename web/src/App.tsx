import { useEffect, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { parseShopPath } from '@regulars/contracts';
import { banner } from './config';
import { WalletContext } from './ui';
import { Landing } from './landing/Landing';
import { Shell } from './app/Shell';
import { Overview } from './app/Overview';
import { ShopPay } from './app/ShopPay';
import { Shops } from './app/Shops';
import { Activity } from './app/Activity';
import { Manage } from './app/Manage';
import { NewShop } from './app/NewShop';
import { Poster } from './app/Poster';

const currentPath = () => window.location.hash.replace(/^#/, '') || '/';

export function Banner() {
  return (
    <div className="banner">
      <span>BCH BLAZE 2026</span>
      {banner.deck && <a href={banner.deck} target="_blank" rel="noreferrer">Presentation</a>}
      {banner.repo && <a href={banner.repo} target="_blank" rel="noreferrer">Source code</a>}
      {banner.donation && <span>EMBER2026 votes: <code>{banner.donation}</code></span>}
    </div>
  );
}

function route(path: string) {
  if (path === '/' || path === '') return { kind: 'landing' as const };
  if (path === '/new') return { kind: 'app' as const, page: 'new' as const };
  if (path.startsWith('/poster/')) {
    const shop = parseShopPath(`/s/${path.slice('/poster/'.length)}`);
    return shop ? { kind: 'poster' as const, shop } : { kind: 'app' as const, page: 'missing' as const };
  }
  if (path.startsWith('/s/')) {
    const shop = parseShopPath(path);
    return shop ? { kind: 'app' as const, page: 'shop' as const, shop } : { kind: 'app' as const, page: 'missing' as const };
  }
  if (path.startsWith('/app/manage/s/')) {
    const shop = parseShopPath(path.slice('/app/manage'.length));
    return { kind: 'app' as const, page: 'manage' as const, shop };
  }
  const page = ({ '/app': 'overview', '/app/shops': 'shops', '/app/activity': 'activity', '/app/manage': 'manage', '/app/new': 'new' } as const)[path];
  return page ? { kind: 'app' as const, page } : { kind: 'app' as const, page: 'missing' as const };
}

export function App() {
  const wc = useWizardConnect({ dappName: 'Regulars' });
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onHash = () => { setPath(currentPath()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const r = route(path);

  return (
    <WalletContext.Provider value={wc}>
      {wc.uri && wc.qrUri && <div data-testid="pairing" data-uri={wc.uri} hidden />}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog show={wc.state === 'connecting'} onClose={() => wc.disconnect()} uri={wc.uri} qrUri={wc.qrUri} title="Regulars" subtitle="Scan with a Bitcoin Cash wallet"
          theme={{ backdropColor: 'rgba(17,19,24,.55)', dialogBackground: '#ffffff', headerBackground: '#ffffff', titleColor: '#111318', subtitleColor: '#9096a1', qrForeground: '#111318' }} />
      )}
      {r.kind === 'landing' && <Landing />}
      {r.kind === 'poster' && <Poster shop={r.shop} />}
      {r.kind === 'app' && (
        <Shell page={r.page}>
          {r.page === 'overview' && <Overview />}
          {r.page === 'shop' && <ShopPay shop={r.shop} key={path} />}
          {r.page === 'shops' && <Shops />}
          {r.page === 'activity' && <Activity />}
          {r.page === 'manage' && <Manage shop={r.shop} key={path} />}
          {r.page === 'new' && <NewShop />}
          {r.page === 'missing' && <p className="notice error" style={{ animation: 'none' }}>That link is not a valid shop. <a href="#/app">Go to the app</a></p>}
        </Shell>
      )}
    </WalletContext.Provider>
  );
}
