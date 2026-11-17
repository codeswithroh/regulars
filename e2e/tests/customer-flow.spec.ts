import { test, beforeAll, afterAll, expect as check } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as playwrightExpect } from '@playwright/test';
import { TransactionBuilder } from 'cashscript';
import { DerivationPath } from '@wizardconnect/wallet';
import { makeIssuer, makeReserve, parseShopPath, shopPath, type Shop } from '@regulars/contracts';
import { demoShop, ownerWallet, prefix, protocol, withConnection } from '../../cli/src/config.js';
import { TestWallet } from './test-wallet.js';
import { WEB_PORT } from './servers.js';

// Chain round-trips take seconds, so web assertions wait longer than Playwright's default 5s.
const expect = playwrightExpect.configure({ timeout: 60_000 });
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;

const owner = ownerWallet();
const shop = demoShop();
const fees = protocol();
const customer = new TestWallet(prefix);
const merchant = new TestWallet(prefix);
const customerAddress = customer.address(DerivationPath.Receive, 0);
// Coins left in the throwaway wallets are not recovered, so keep this small on mainnet.
const START_BALANCE = BigInt(process.env.E2E_START_BALANCE ?? 30_000);
const MERCHANT_BALANCE = 30_000n;
const num = (n: bigint) => n.toLocaleString('en-US');

const chain = (s: Shop) => withConnection(async (provider) => {
  const [issuers, reserves] = await Promise.all([makeIssuer(s, fees, provider).getUtxos(), makeReserve(s, provider).getUtxos()]);
  return {
    stampsLeft: issuers.reduce((sum, u) => sum + (u.token?.amount ?? 0n), 0n),
    issuerSats: issuers.reduce((sum, u) => sum + u.satoshis, 0n),
    reserveSats: reserves.reduce((sum, u) => sum + u.satoshis, 0n),
    reserveStamps: reserves.reduce((sum, u) => sum + (u.token?.amount ?? 0n), 0n),
  };
});
const utxosAt = (address: string) => withConnection((provider) => provider.getUtxos(address));

let browser: Browser;
const extraWallets: TestWallet[] = [];
const open = async (): Promise<Page> => (await browser.newContext({ baseURL })).newPage();
const pair = async (page: Page, wallet: TestWallet, path: string) => {
  await page.goto(`/#${path}`);
  await page.locator('.top').getByRole('button', { name: 'Connect wallet' }).click();
  wallet.connect((await page.getByTestId('pairing').getAttribute('data-uri'))!);
  await expect(page.getByRole('button', { name: /Test Wallet · Disconnect/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toBeVisible();
};

/** Pick an amount (a preset like '5,000' or a custom number) and confirm with the Pay button. */
const payWith = async (page: Page, amount: string, custom = false) => {
  if (custom) await page.getByLabel('Other amount in sats').fill(amount.replace(/,/g, ''));
  else await page.getByRole('radio', { name: new RegExp(`^${amount} sats`) }).click();
  await page.getByRole('button', { name: new RegExp(`^Pay ${amount} sats`) }).click();
};
/** Open the Redeem tab and redeem every stamp. */
const redeemAll = async (page: Page) => {
  await page.getByRole('tab', { name: /^Redeem/ }).click();
  await page.getByRole('button', { name: /^Redeem \d+ stamps/ }).click();
};

beforeAll(async () => {
  browser = await chromium.launch();
  // Fund both throwaway wallets from the owner key. The merchant's coin is deliberately not
  // output 0, so opening a shop has to take the two-signature path.
  await withConnection(async (provider) => {
    // Combine the owner's plain coins: test runs leave them fragmented.
    const coins = (await provider.getUtxos(owner.address)).filter((u) => !u.token);
    const total = coins.reduce((sum, u) => sum + u.satoshis, 0n);
    const withMerchant = !process.env.E2E_SKIP_MERCHANT;
    const spend = START_BALANCE + (withMerchant ? MERCHANT_BALANCE : 0n);
    const fee = BigInt(coins.length) * 150n + 300n;
    if (total < spend + fee + 546n) throw new Error(`Owner key holds ${total} sats; tests need ${spend + fee}. Fund ${owner.address}.`);
    const tx = new TransactionBuilder({ provider }).addInputs(coins, owner.signer.unlockP2PKH()).addOutput({ to: customerAddress, amount: START_BALANCE });
    if (withMerchant) tx.addOutput({ to: merchant.address(DerivationPath.Receive, 0), amount: MERCHANT_BALANCE });
    await tx.addOutput({ to: owner.address, amount: total - spend - fee }).send();
  });
});

afterAll(async () => {
  await browser?.close();
  for (const w of [customer, merchant, ...extraWallets]) w.close();
  await new Promise((resolve) => setTimeout(resolve, 1500)); // let relay sockets finish closing
});

test('a customer pays and receives stamps in the same transaction, then redeems them', async () => {
  const page = await open();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await pair(page, customer, shopPath(shop));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shop.name);
  await expect(page.getByTestId('balance')).toContainText(`${num(START_BALANCE)} sats`);
  await expect(page.getByTestId('stamps')).toHaveText('0');
  const before = await chain(shop);

  await payWith(page, '5,000', true);
  await expect(page.getByRole('status')).toContainText('earned 5 stamps in the same transaction');
  await expect(page.getByTestId('stamps')).toHaveText('5');

  // One transaction did all of it: shop paid, stamps delivered, protocol fee accrued.
  const paymentTxid = (await page.getByRole('link', { name: 'View transaction' }).getAttribute('href'))!.split('/').pop()!;
  const mine = await utxosAt(customerAddress);
  check(mine.filter((u) => u.token?.category === shop.category).map((u) => [u.txid, u.token!.amount])).toEqual([[paymentTxid, 5n]]);
  check((await utxosAt(owner.address)).some((u) => u.txid === paymentTxid && u.satoshis === 5000n - 5n * fees.feePerStamp)).toBe(true);
  const paid = await chain(shop);
  check(before.stampsLeft - paid.stampsLeft).toBe(5n);
  check(paid.issuerSats - before.issuerSats).toBe(5n * fees.feePerStamp);

  await redeemAll(page);
  await expect(page.getByRole('status')).toContainText(/Redeemed 5 stamps for/);
  await expect(page.getByTestId('stamps')).toHaveText('0');
  const after = await chain(shop);
  check(paid.reserveSats - after.reserveSats).toBe(5n * shop.redeem);
  check(after.reserveStamps - paid.reserveStamps).toBe(5n);
  await expect(page.getByTestId('reserve')).toHaveText(`${num(after.reserveSats)} sats`);
  check((await utxosAt(customerAddress)).some((u) => u.token)).toBe(false);
  check(customer.signed).toHaveLength(2);
  check(errors).toEqual([]);
});

test('a rejected signature charges nothing; several payments and a custom amount redeem together', async () => {
  const page = await open();
  await pair(page, customer, shopPath(shop));
  const signedBefore = customer.signed.length;
  const before = await chain(shop);

  customer.rejectNext = true;
  await payWith(page, '2,000', true);
  await expect(page.locator('.notice.error')).toContainText('User rejected the request');
  check(customer.signed).toHaveLength(signedBefore);
  check((await chain(shop)).stampsLeft).toBe(before.stampsLeft);

  await payWith(page, '2,000', true);
  await expect(page.getByRole('status')).toContainText('earned 2 stamps');
  await payWith(page, '3,500', true);
  await expect(page.getByRole('status')).toContainText('Paid 3,500 sats and earned 3 stamps');
  await expect(page.getByTestId('stamps')).toHaveText('5');

  await redeemAll(page);
  await expect(page.getByRole('status')).toContainText(/Redeemed 5 stamps for/);
  await expect(page.getByTestId('stamps')).toHaveText('0');
  const after = await chain(shop);
  check(before.reserveSats - after.reserveSats).toBe(5n * shop.redeem);
  check(before.stampsLeft - after.stampsLeft).toBe(5n);
});

test('a wallet without funds gets a clear message instead of a broken transaction', async () => {
  const empty = new TestWallet(prefix);
  const page = await open();
  await pair(page, empty, shopPath(shop));
  await expect(page.getByTestId('balance')).toContainText('Balance 0 sats');
  await payWith(page, '2,000', true);
  await expect(page.locator('.notice.error')).toContainText('not enough to pay');
  check(empty.signed).toHaveLength(0);
  extraWallets.push(empty);
});

test('a wallet reconnects after a page reload without scanning again', async () => {
  const page = await open();
  await pair(page, customer, shopPath(shop));

  // The connected dashboard reflects this wallet's earlier payments and redemptions.
  await page.goto('/#/app');
  await expect(page.getByTestId('tile-balance')).toContainText('sats');
  await expect(page.getByTestId('tile-stamps')).not.toContainText('—');
  await page.goto('/#/app/activity');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.locator('tbody')).toContainText(shop.name);
  await expect(page.locator('tbody')).toContainText('Redeemed');

  await page.goto(`/#${shopPath(shop)}`);
  await page.reload();
  await expect(page.getByRole('button', { name: /Test Wallet · Disconnect/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toBeVisible();
  await page.getByRole('button', { name: /Test Wallet · Disconnect/ }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('.top').getByRole('button', { name: 'Connect wallet' })).toBeVisible();
});

test.skipIf(Boolean(process.env.E2E_SKIP_MERCHANT))('a merchant opens a shop from their own wallet and a customer earns there', async () => {
  const page = await open();
  await pair(page, merchant, '/app/new');
  await expect(page.getByTestId('summary')).toContainText('Give your shop a name');
  await expect(page.getByRole('button', { name: 'Open shop' })).toBeDisabled();

  await page.getByLabel('Shop name').fill('Corner Coffee & Co');
  await page.getByLabel('Sats spent per stamp').fill('500');
  await page.getByLabel('Cashback %').fill('4');
  await page.getByLabel('Reward reserve (sats)').fill('6000');
  await expect(page.getByTestId('summary')).toContainText('redeem each for 20 sats');
  await page.getByRole('button', { name: 'Open shop' }).click();
  await expect(page.getByTestId('opened')).toContainText('Corner Coffee & Co is live');
  check(merchant.signed).toHaveLength(2); // preparation + opening

  const link = (await page.getByTestId('shop-link').innerText()).trim();
  const opened = parseShopPath(new URL(link).hash.slice(1))!;
  check(opened).toMatchObject({ name: 'Corner Coffee & Co', earn: 500n, redeem: 20n });
  const fresh = await chain(opened);
  check(fresh).toMatchObject({ stampsLeft: 1_000_000n, reserveSats: 6000n, issuerSats: 8000n });

  // The poster carries a QR code for the same link.
  await page.getByRole('button', { name: 'Print poster' }).click();
  await expect(page.getByTestId('poster-qr')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Corner Coffee & Co');

  // A customer who only has the link can pay the new shop and be rewarded.
  const visitor = await open();
  await pair(visitor, customer, shopPath(opened));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Corner Coffee & Co');
  await payWith(visitor, '1,000', true);
  await expect(visitor.getByRole('status')).toContainText('earned 2 stamps');
  const paidTo = merchant.address(DerivationPath.Receive, 0);
  check((await utxosAt(paidTo)).some((u) => u.satoshis === 1000n - 2n * fees.feePerStamp)).toBe(true);
  await redeemAll(visitor);
  await expect(visitor.getByRole('status')).toContainText(/Redeemed 2 stamps for/);
  check((await chain(opened)).reserveSats).toBe(6000n - 40n);

  // The owner closes the shop: the reserve comes back, every issuer output is retired and its stamps burned.
  const before = (await utxosAt(paidTo)).reduce((sum, u) => sum + u.satoshis, 0n);
  await page.goto(`/#/app/manage${shopPath(opened)}`);
  await page.getByRole('button', { name: 'Close shop…' }).click();
  await expect(page.getByTestId('close-shop')).toContainText('Wallet approvals');
  const closeButton = page.getByRole('button', { name: 'Close shop', exact: true });
  await expect(closeButton).toBeDisabled();
  await page.getByLabel('Shop name to confirm').fill('Corner Coffee & Co');
  const signedBefore = merchant.signed.length;
  await closeButton.click();
  await expect(page.getByRole('status')).toContainText('Corner Coffee & Co is closed', { timeout: 180_000 });
  check(merchant.signed.length - signedBefore).toBe(8); // one per issuer output; the reserve rides along with the first
  check(await chain(opened)).toMatchObject({ stampsLeft: 0n, issuerSats: 0n, reserveSats: 0n });
  const after = (await utxosAt(paidTo)).reduce((sum, u) => sum + u.satoshis, 0n);
  check(after - before).toBeGreaterThan(5000n);
  // The link now says the shop is not taking payments.
  await visitor.goto(`/#${shopPath(opened)}`);
  await visitor.reload();
  await expect(visitor.locator('.notice.error')).toContainText('This shop is not taking payments');
}, 600_000);

test('the home page shows the live demo shop, and broken links are handled', async () => {
  const page = await open();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('real money');
  await expect(page.getByTestId('demo-shop')).toContainText(shop.name);
  await expect(page.getByTestId('demo-reserve')).toHaveText(`${num((await chain(shop)).reserveSats)} sats`);
  await page.getByRole('button', { name: 'Try the demo shop' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shop.name);
  // Not connected: the pay panel asks for a wallet instead of offering to pay.
  await expect(page.locator('.pay-main').getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);

  // The landing CTA carries the shop name into the open-a-shop form.
  await page.goto('/');
  await page.getByLabel("Your shop's name").fill('Sunrise Bakery');
  await page.getByRole('button', { name: 'START' }).click();
  await expect(page.getByLabel('Shop name')).toHaveValue('Sunrise Bakery');

  // The dashboard's analytics read the demo shop's history from the chain.
  await page.goto('/#/app/manage');
  await expect(page.getByTestId('revenue')).toContainText('sats');

  await page.goto('/#/s/Nope/zz/zz/1/1');
  await expect(page.locator('.notice.error')).toContainText('not a valid shop');
  await page.goto(`/#/s/Ghost/${'ab'.repeat(32)}/${'cd'.repeat(20)}/1000/30`);
  await expect(page.locator('.notice.error')).toContainText('This shop is not taking payments');
});
