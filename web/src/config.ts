import { Network } from 'cashscript';
import { parseShopPath, type Protocol } from '@regulars/contracts';

const value = (key: string) => String(import.meta.env[key] ?? '').split('#')[0].trim();

export const network = value('VITE_NETWORK') === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
export const prefix = network === Network.MAINNET ? 'bitcoincash' : 'bchtest';

/** Protocol-wide settings; every shop opened from this site uses them. */
export const protocol: Protocol = {
  feePerStamp: BigInt(value('VITE_FEE_PER_STAMP') || '10'),
  protocolPkh: value('VITE_PROTOCOL_PKH'),
};
export const configured = /^[0-9a-f]{40}$/.test(protocol.protocolPkh);

/** The shop featured on the home page. */
export const demoShop = parseShopPath(value('VITE_DEMO_SHOP'));

/** Required BLAZE banner links. */
export const banner = { deck: value('VITE_DECK_URL'), repo: value('VITE_REPO_URL'), donation: value('VITE_DONATION_ADDRESS') };

export const explorerTx = (txid: string) =>
  network === Network.MAINNET ? `https://explorer.bch.ninja/tx/${txid}` : `https://chipnet.bch.ninja/tx/${txid}`;
