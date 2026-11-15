import { useEffect, useState } from 'react';
import { BadgeCheck, ShieldQuestion } from 'lucide-react';
import { addressOfPkh, findByAddress, type Identity } from '@regulars/bch-nostr-id';
import type { Shop } from '@regulars/contracts';
import { network } from '../config';
import { fetchTx } from '../wallet';

/**
 * Who runs this shop. Shop links are self-describing, so anyone can craft a link that reuses a name.
 * If the shop's payout address is bound to a Nostr identity, show it, so customers can tell the real shop.
 */
export function MerchantBadge({ shop }: { shop: Shop }) {
  const [owner, setOwner] = useState<Identity | null>();
  useEffect(() => {
    let live = true;
    findByAddress(addressOfPkh(shop.merchantPkh, network), { fetchTx })
      .then((found) => { if (live) setOwner(found[0] ?? null); })
      .catch(() => live && setOwner(null));
    return () => { live = false; };
  }, [shop.merchantPkh]);
  if (owner === undefined) return null;
  if (!owner) {
    return <span className="pill neutral" data-testid="merchant-unverified" title="The shop's payout address is not linked to a Nostr identity"><ShieldQuestion size={13} />Merchant not verified</span>;
  }
  const name = owner.profile?.display_name || owner.profile?.name || `${owner.npub.slice(0, 12)}…`;
  return (
    <a className="pill good" data-testid="merchant-verified" href={`#/app/id/${owner.npub}`} title="The shop's payout address is linked to this Nostr identity">
      <BadgeCheck size={13} />Run by {name}
    </a>
  );
}
