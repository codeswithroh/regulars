// Pure aggregation over shop events (no chain dependencies).
import type { ShopEvent } from './history';

export interface ShopStats {
  revenue: bigint;
  issued: bigint;
  redeemed: bigint;
  rewardsPaid: bigint;
  customers: number;
  payments: number;
}

export function statsOf(events: ShopEvent[], since = 0): ShopStats {
  const inWindow = events.filter((e) => e.time >= since);
  const earns = inWindow.filter((e) => e.kind === 'earn');
  const redeems = inWindow.filter((e) => e.kind === 'redeem');
  return {
    revenue: earns.reduce((s, e) => s + e.sats, 0n),
    issued: earns.reduce((s, e) => s + e.stamps, 0n),
    redeemed: redeems.reduce((s, e) => s + e.stamps, 0n),
    rewardsPaid: redeems.reduce((s, e) => s + e.sats, 0n),
    customers: new Set(earns.map((e) => e.customer).filter(Boolean)).size,
    payments: earns.length,
  };
}

