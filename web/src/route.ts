import { parseShopPath, type Shop } from '@regulars/contracts/links';

export type AppPage = 'overview' | 'shop' | 'shops' | 'activity' | 'manage' | 'new' | 'missing';
export type Route =
  | { kind: 'landing' }
  | { kind: 'poster'; shop: Shop }
  | { kind: 'app'; page: AppPage; shop?: Shop };

export function route(path: string): Route {
  if (path === '/' || path === '') return { kind: 'landing' };
  if (path === '/new') return { kind: 'app', page: 'new' };
  if (path.startsWith('/poster/')) {
    const shop = parseShopPath(`/s/${path.slice('/poster/'.length)}`);
    return shop ? { kind: 'poster', shop } : { kind: 'app', page: 'missing' };
  }
  if (path.startsWith('/s/')) {
    const shop = parseShopPath(path);
    return shop ? { kind: 'app', page: 'shop', shop } : { kind: 'app', page: 'missing' };
  }
  if (path.startsWith('/app/manage/s/')) return { kind: 'app', page: 'manage', shop: parseShopPath(path.slice('/app/manage'.length)) };
  const page = ({ '/app': 'overview', '/app/shops': 'shops', '/app/activity': 'activity', '/app/manage': 'manage', '/app/new': 'new' } as const)[path];
  return page ? { kind: 'app', page } : { kind: 'app', page: 'missing' };
}
