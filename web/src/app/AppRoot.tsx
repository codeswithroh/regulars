import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
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

/** The dashboard: wallet connection plus every app page. */
export function AppRoot({ page, shop, path }: { page: AppPage; shop?: Shop; path: string }) {
  const wc = useWizardConnect({ dappName: 'Regulars' });
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
        {page === 'missing' && <p className="notice error" style={{ animation: 'none' }}>That link is not a valid shop. <a href="#/app">Go to the app</a></p>}
      </Shell>
    </WalletContext.Provider>
  );
}
