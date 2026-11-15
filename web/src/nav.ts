// Navigation and remembered shops, with no chain dependencies (the landing page uses these).
import { shopPath, type Shop } from '@regulars/contracts/links';

export const go = (path: string) => { window.location.hash = path; };
export const keyOf = (shop: Shop) => shopPath(shop);

export const VISITED = 'regulars-shops';
export const MINE = 'regulars-my-shops';
export const readList = (key: string): string[] => { try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; } };
const writeList = (key: string, list: string[]) => { try { localStorage.setItem(key, JSON.stringify(list.slice(0, 30))); } catch { /* private window */ } window.dispatchEvent(new Event('regulars-shops')); };
export const rememberShop = (shop: Shop) => { const p = keyOf(shop); writeList(VISITED, [p, ...readList(VISITED).filter((x) => x !== p)]); };
export const rememberMine = (shop: Shop) => { const p = keyOf(shop); writeList(MINE, [p, ...readList(MINE).filter((x) => x !== p)]); rememberShop(shop); };
