import { useCallback, useEffect, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { banner, configured, explorerTx, merchant, network, reserveParams, satsPerStampEarned } from './config';
import { payMerchant, readReserve, readWallet, redeemStamps, requestStamps, type ReserveState, type WalletState } from './wallet';

const PAY_OPTIONS = [2000n, 5000n, 10000n];
const sats = (n: bigint) => `${n.toLocaleString('en-US')} sats`;
const cashbackPercent = Number((reserveParams.satsPerStamp * 10000n) / satsPerStampEarned) / 100;

type Notice = { kind: 'ok' | 'error' | 'busy'; text: string; txid?: string };

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

export function App() {
  const wc = useWizardConnect({ dappName: 'Regulars' });
  const [wallet, setWallet] = useState<WalletState>();
  const [reserve, setReserve] = useState<ReserveState>();
  const [notice, setNotice] = useState<Notice>();
  const connected = wc.state === 'connected' && wc.manager;

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      setReserve(await readReserve());
      if (wc.state === 'connected' && wc.manager) setWallet(await readWallet(wc.manager));
    } catch (error) {
      setNotice({ kind: 'error', text: `Could not read the chain: ${error instanceof Error ? error.message : error}` });
    }
  }, [wc.state, wc.manager]);

  // Stamps arrive a few seconds after a payment, so keep balances fresh.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (wc.state !== 'connected') return setWallet(undefined);
    // Pick up stamps for payments made outside this page, e.g. by scanning the shop's QR code.
    if (configured) requestStamps().then(refresh, () => undefined);
  }, [wc.state, refresh]);

  const act = async (busy: string, run: () => Promise<Notice>) => {
    setNotice({ kind: 'busy', text: busy });
    try {
      const result = await run();
      await refresh(); // balances are current before the result is shown
      setNotice(result);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  // Each action re-reads the wallet first: spending from a cached coin list would conflict
  // with a transaction sent a moment ago.
  const pay = (amount: bigint) => act('Approve the payment in your wallet…', async () => {
    const manager = wc.manager!;
    const before = await readWallet(manager);
    const txid = await payMerchant(manager, before, amount);
    setNotice({ kind: 'busy', text: `Paid ${sats(amount)}. Collecting your stamps…`, txid });
    // The shop may not see the payment for a second or two, so ask a few times. Another request
    // (this page on connect, or the shop's own loop) may reward it first, so also watch the balance.
    for (let attempt = 0; attempt < 15; attempt++) {
      const [issued] = await requestStamps(txid);
      const now = await readWallet(manager);
      const earned = issued ? BigInt(issued.stamps) : now.stamps - before.stamps;
      if (earned > 0n) return { kind: 'ok', text: `Paid ${sats(amount)} and earned ${earned} stamps.`, txid };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { kind: 'ok', text: `Paid ${sats(amount)}. Your stamps will arrive shortly.`, txid };
  });

  const redeem = () => act('Approve the redemption in your wallet…', async () => {
    const manager = wc.manager!;
    const [fresh, pot] = await Promise.all([readWallet(manager), readReserve()]);
    if (fresh.stamps === 0n) throw new Error('No stamps to redeem yet');
    const { txid, payout } = await redeemStamps(manager, fresh, pot, fresh.stamps);
    return { kind: 'ok', text: `Redeemed ${fresh.stamps} stamps for ${sats(payout)} cashback.`, txid };
  });

  const stamps = wallet?.stamps ?? 0n;
  const worth = stamps * reserveParams.satsPerStamp;
  const busy = notice?.kind === 'busy';

  return (
    <>
      <Banner />
      <header>
        <div className="brand">Regulars<small>{network === 'mainnet' ? '' : ' · chipnet'}</small></div>
        {connected
          ? <button className="ghost" onClick={() => wc.disconnect()}>{wc.walletName ?? 'Wallet'} · Disconnect</button>
          : <button onClick={() => wc.connect()} disabled={wc.state === 'connecting'}>Connect wallet</button>}
      </header>

      {wc.uri && wc.qrUri && (
        <div data-testid="pairing" data-uri={wc.uri} hidden />
      )}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog show={wc.state === 'connecting'} onClose={() => wc.disconnect()} uri={wc.uri} qrUri={wc.qrUri} title="Regulars" />
      )}

      <main>
        <section className="hero">
          <h1>Pay in Bitcoin Cash.<br />Get {cashbackPercent}% back.</h1>
          <p>Every payment to {merchant.name} earns stamps. Stamps are redeemable for BCH from a reserve the shop cannot take back from you.</p>
        </section>

        {!configured && (
          <p className="notice error">This shop is not set up yet. Run the merchant setup (see README), then rebuild.</p>
        )}

        <section className="grid">
          <div className="card">
            <h2>1. Pay {merchant.name}</h2>
            <p className="muted">1 stamp per {sats(satsPerStampEarned)} spent.</p>
            <div className="row">
              {PAY_OPTIONS.map((amount) => (
                <button key={String(amount)} disabled={!connected || !wallet || busy || !configured} onClick={() => pay(amount)}>
                  {sats(amount)}
                </button>
              ))}
            </div>
            {connected && wallet && <p className="muted" data-testid="balance">Wallet balance: {sats(wallet.bch)}</p>}
            {!connected && <p className="muted">Connect a wallet to pay.</p>}
          </div>

          <div className="card">
            <h2>2. Your stamps</h2>
            <div className="big" data-testid="stamps">{stamps.toLocaleString('en-US')}</div>
            <p className="muted">Worth {sats(worth)} today.</p>
            <button disabled={!connected || stamps === 0n || busy || !reserve?.utxo} onClick={redeem}>Redeem for BCH</button>
          </div>

          <div className="card">
            <h2>Reward reserve</h2>
            <div className="big" data-testid="reserve">{reserve ? sats(reserve.sats) : '…'}</div>
            <p className="muted">Locked on-chain. Pays {sats(reserveParams.satsPerStamp)} per stamp to anyone who hands stamps in.</p>
          </div>
        </section>

        {notice && (
          <p className={`notice ${notice.kind}`} role="status">
            {notice.text}{' '}
            {notice.txid && <a href={explorerTx(notice.txid)} target="_blank" rel="noreferrer">View transaction</a>}
          </p>
        )}
        {wc.error && <p className="notice error">{wc.error}</p>}
      </main>
    </>
  );
}
