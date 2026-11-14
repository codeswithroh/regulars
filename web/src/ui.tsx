import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { UseWizardConnectResult } from '@wizardconnect/react';
import type { Shop } from '@regulars/contracts';
import { explorerTx } from './config';
import { readShop, readWallet, type ShopState, type WalletState } from './wallet';

export const sats = (n: bigint) => `${n.toLocaleString('en-US')} sats`;
export const cashbackPercent = (shop: { earn: bigint; redeem: bigint }) => Number((shop.redeem * 10000n) / shop.earn) / 100;

export const WalletContext = createContext<UseWizardConnectResult>(null!);
export const useWalletConnection = () => useContext(WalletContext);

export type Notice = { kind: 'ok' | 'error' | 'busy'; text: string; txid?: string };

export function NoticeBar({ notice }: { notice?: Notice }) {
  if (!notice) return null;
  return (
    <p className={`notice ${notice.kind}`} role="status">
      {notice.text}{' '}
      {notice.txid && <a href={explorerTx(notice.txid)} target="_blank" rel="noreferrer">View transaction</a>}
    </p>
  );
}

/** Run a wallet action with busy / done / failed feedback. */
export function useAction(afterwards?: () => Promise<unknown>) {
  const [notice, setNotice] = useState<Notice>();
  const run = async (busy: string, work: (say: (text: string) => void) => Promise<Notice>) => {
    setNotice({ kind: 'busy', text: busy });
    try {
      const result = await work((text) => setNotice({ kind: 'busy', text }));
      await afterwards?.(); // balances are current before the result is shown
      setNotice(result);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };
  return { notice, run, busy: notice?.kind === 'busy' };
}

/** Live shop and wallet balances, refreshed every few seconds. */
export function useLive(shop: Shop | undefined) {
  const wc = useWalletConnection();
  const [state, setState] = useState<ShopState>();
  const [wallet, setWallet] = useState<WalletState>();
  const [error, setError] = useState<string>();
  const manager = wc.state === 'connected' ? wc.manager : null;

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextWallet] = await Promise.all([shop ? readShop(shop) : undefined, manager ? readWallet(manager) : undefined]);
      setState(nextState);
      setWallet(nextWallet);
      setError(undefined);
    } catch (e) {
      setError(`Could not read the chain: ${e instanceof Error ? e.message : e}`);
    }
  }, [shop?.category, shop?.merchantPkh, shop?.earn, shop?.redeem, manager]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { state, wallet, manager, refresh, error };
}

/** A ten-slot punch card that fills as stamps accrue. */
export function PunchCard({ stamps }: { stamps: bigint }) {
  const filled = stamps === 0n ? 0 : Number((stamps - 1n) % 10n) + 1;
  return (
    <div className="punch" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <span key={i} className={i < filled ? 'on' : ''} />)}
    </div>
  );
}

export const go = (path: string) => { window.location.hash = path; };
