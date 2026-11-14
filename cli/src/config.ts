// Settings for the command-line tools and tests. The web app needs none of this: it has no backend.
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ElectrumNetworkProvider, Network, SignatureTemplate } from 'cashscript';
import { decodePrivateKeyWif, secp256k1, hash160, binToHex, encodeCashAddress } from '@bitauth/libauth';
import { parseShopPath, type Protocol, type Shop } from '@regulars/contracts';

// ENV_FILE picks the config, e.g. ENV_FILE=.env.mainnet; the default .env is the chipnet setup.
export const ENV_PATH = fileURLToPath(new URL(`../../${process.env.ENV_FILE ?? '.env'}`, import.meta.url));
loadEnv({ path: ENV_PATH });

export const env = (name: string) => (process.env[name] ?? '').split('#')[0].trim();
export function need(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not set in ${ENV_PATH}`);
  return value;
}

export const network = env('NETWORK') === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
export const prefix = network === Network.MAINNET ? 'bitcoincash' : 'bchtest';

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

export function walletFrom(privateKey: Uint8Array) {
  const pub = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pub === 'string') throw new Error(pub);
  const pkh = hash160(pub);
  const address = (type: 'p2pkh' | 'p2pkhWithTokens') => encodeCashAddress({ prefix, type, payload: pkh, throwErrors: true }).address;
  return { pub, pkhHex: binToHex(pkh), address: address('p2pkh'), tokenAddress: address('p2pkhWithTokens'), signer: new SignatureTemplate(privateKey) };
}

/** The key that owns the demo shop, funds test wallets and receives protocol fees. */
export function ownerWallet(wif = need('MERCHANT_WIF')) {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(`MERCHANT_WIF is not a valid key: ${decoded}`);
  return walletFrom(decoded.privateKey);
}

export const protocol = (): Protocol => ({
  feePerStamp: BigInt(env('VITE_FEE_PER_STAMP') || '10'),
  protocolPkh: env('VITE_PROTOCOL_PKH') || ownerWallet().pkhHex,
});

export function demoShop(): Shop {
  const shop = parseShopPath(need('VITE_DEMO_SHOP'));
  if (!shop) throw new Error('VITE_DEMO_SHOP is not a valid shop path');
  return shop;
}
