import { useEffect, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { parseShopPath } from '@regulars/contracts';
import { banner, configured, network } from './config';
import { WalletContext, go } from './ui';
import { Home } from './pages/Home';
import { ShopPage } from './pages/ShopPage';
import { NewShop } from './pages/NewShop';
import { Poster } from './pages/Poster';

const currentPath = () => window.location.hash.replace(/^#/, '') || '/';

function Banner() {
  return (
    <div className="banner">
      <span>BCH BLAZE 2026</span>
      {banner.deck && <a href={banner.deck} target="_blank" rel="noreferrer">Presentation</a>}
      {banner.repo && <a href={banner.repo} target="_blank" rel="noreferrer">Source code</a>}
      {banner.donation && <span className="donation">EMBER2026 votes: <code>{banner.donation}</code></span>}
    </div>
  );
}

function Page({ path }: { path: string }) {
  if (path === '/new') return <NewShop />;
  const poster = path.startsWith('/poster/') ? parseShopPath(`/s/${path.slice('/poster/'.length)}`) : undefined;
  if (poster) return <Poster shop={poster} />;
  const shop = parseShopPath(path);
  if (shop) return <ShopPage shop={shop} key={path} />;
  if (path !== '/') return <p className="notice error">That link is not a valid shop. <a href="#/">Go home</a></p>;
  return <Home />;
}

export function App() {
  const wc = useWizardConnect({ dappName: 'Regulars' });
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onHash = () => { setPath(currentPath()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const connected = wc.state === 'connected' && wc.manager;

  return (
    <WalletContext.Provider value={wc}>
      <Banner />
      <header className="noprint">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go('/'); }}>Regulars<small>{network === 'mainnet' ? '' : ' · chipnet'}</small></a>
        <nav>
          <a href="#/new">Open a shop</a>
          {connected
            ? <button className="ghost" onClick={() => wc.disconnect()}>{wc.walletName ?? 'Wallet'} · Disconnect</button>
            : <button onClick={() => wc.connect()} disabled={wc.state === 'connecting'}>Connect wallet</button>}
        </nav>
      </header>

      {wc.uri && wc.qrUri && <div data-testid="pairing" data-uri={wc.uri} hidden />}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog show={wc.state === 'connecting'} onClose={() => wc.disconnect()} uri={wc.uri} qrUri={wc.qrUri} title="Regulars" />
      )}

      <main>
        {!configured && <p className="notice error">This site is not configured yet (missing protocol settings).</p>}
        <Page path={path} />
        {wc.error && <p className="notice error">{wc.error}</p>}
      </main>
      <footer className="noprint">Two contracts and a static page. No backend. <a href={banner.repo || '#/'}>Read the code</a>.</footer>
    </WalletContext.Provider>
  );
}
