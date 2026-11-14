import { Network } from 'cashscript';
import type { ReserveParams } from '@regulars/contracts';

const env = import.meta.env;
const value = (key: string) => String(env[key] ?? '').split('#')[0].trim();

export const network = value('VITE_NETWORK') === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
export const prefix = network === Network.MAINNET ? 'bitcoincash' : 'bchtest';

export const merchant = {
  name: value('VITE_MERCHANT_NAME') || 'Demo Café',
  address: value('VITE_MERCHANT_ADDRESS'),
  pkh: value('VITE_MERCHANT_PKH'),
};

export const satsPerStampEarned = BigInt(value('VITE_SATS_PER_STAMP_EARNED') || '1000');

export const reserveParams: ReserveParams = {
  stampCategory: value('VITE_STAMP_CATEGORY'),
  satsPerStamp: BigInt(value('VITE_SATS_PER_STAMP') || '30'),
  merchantPkh: merchant.pkh,
};

/** False until the merchant has run keygen + mint and the values are in .env. */
export const configured = Boolean(merchant.address && merchant.pkh && reserveParams.stampCategory);

/** Required BLAZE banner links. */
export const banner = {
  deck: value('VITE_DECK_URL'),
  repo: value('VITE_REPO_URL'),
  donation: value('VITE_DONATION_ADDRESS'),
};

export const explorerTx = (txid: string) =>
  network === Network.MAINNET ? `https://explorer.bch.ninja/tx/${txid}` : `https://chipnet.bch.ninja/tx/${txid}`;
