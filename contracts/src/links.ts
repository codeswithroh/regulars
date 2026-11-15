// Shop links, with no dependencies, so pages can parse a link without loading the BCH libraries.

/** Everything that defines a shop. The two contract addresses follow from these values alone. */
export interface Shop {
  name: string;
  /** Stamp token category as wallets and explorers show it (hex). */
  category: string;
  /** hash160 of the shop's public key (hex): where payments go. */
  merchantPkh: string;
  /** Customer earns one stamp per this many sats paid. */
  earn: bigint;
  /** The reserve pays this many sats per stamp redeemed. */
  redeem: bigint;
}

/** Shops live in their link: `/#/s/<name>/<category>/<merchantPkh>/<earn>/<redeem>`. */
export const shopPath = (shop: Shop) =>
  `/s/${encodeURIComponent(shop.name)}/${shop.category}/${shop.merchantPkh}/${shop.earn}/${shop.redeem}`;

export function parseShopPath(path: string): Shop | undefined {
  const [, kind, name, category, merchantPkh, earn, redeem] = path.split('/');
  if (kind !== 's' || !/^[0-9a-f]{64}$/.test(category ?? '') || !/^[0-9a-f]{40}$/.test(merchantPkh ?? '')) return undefined;
  if (!/^[1-9]\d{0,15}$/.test(earn ?? '') || !/^[1-9]\d{0,15}$/.test(redeem ?? '')) return undefined;
  try {
    return { name: decodeURIComponent(name).slice(0, 60), category, merchantPkh, earn: BigInt(earn), redeem: BigInt(redeem) };
  } catch {
    return undefined;
  }
}
