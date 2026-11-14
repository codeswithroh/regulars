import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ElectrumNetworkProvider, Network, SignatureTemplate } from 'cashscript';
import { decodePrivateKeyWif, secp256k1, hash160, binToHex, encodeCashAddress } from '@bitauth/libauth';
import { makeReserve, type ReserveParams } from '@regulars/contracts';

// ENV_FILE picks the config, e.g. ENV_FILE=.env.mainnet; the default .env is the chipnet setup.
export const ENV_PATH = fileURLToPath(new URL(`../../${process.env.ENV_FILE ?? '.env'}`, import.meta.url));
loadEnv({ path: ENV_PATH });

const env = (name: string) => (process.env[name] ?? '').split('#')[0].trim();

export function need(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

export const network = env('NETWORK') === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
export const prefix = network === Network.MAINNET ? 'bitcoincash' : 'bchtest';
export const provider = () => new ElectrumNetworkProvider(network);

/** Run `work` over one Electrum connection instead of reconnecting for every request. */
export async function withConnection<T>(work: (provider: ElectrumNetworkProvider) => Promise<T>): Promise<T> {
  const connected = new ElectrumNetworkProvider(network, { manualConnectionManagement: true });
  await connected.connect();
  try {
    return await work(connected);
  } finally {
    await connected.disconnect().catch(() => false);
  }
}

export function merchantWallet(wif = need('MERCHANT_WIF')) {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(`MERCHANT_WIF is not a valid key: ${decoded}`);
  const pub = secp256k1.derivePublicKeyCompressed(decoded.privateKey);
  if (typeof pub === 'string') throw new Error(pub);
  const pkh = hash160(pub);
  const address = (type: 'p2pkh' | 'p2pkhWithTokens') =>
    encodeCashAddress({ prefix, type, payload: pkh, throwErrors: true }).address;
  return {
    pkh,
    pkhHex: binToHex(pkh),
    address: address('p2pkh'),
    tokenAddress: address('p2pkhWithTokens'),
    signer: new SignatureTemplate(decoded.privateKey),
  };
}

export function reserveParams(merchantPkhHex: string): ReserveParams {
  return {
    stampCategory: need('STAMP_CATEGORY'),
    satsPerStamp: BigInt(need('SATS_PER_STAMP')),
    merchantPkh: merchantPkhHex,
  };
}

export const reserveFor = (merchantPkhHex: string, p = provider()) => makeReserve(reserveParams(merchantPkhHex), p);
