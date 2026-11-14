import { test, beforeAll, afterAll, expect as check } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as playwrightExpect } from '@playwright/test';
import { WEB_PORT } from './servers.js';
import { TransactionBuilder } from 'cashscript';
import { DerivationPath } from '@wizardconnect/wallet';
import { merchantWallet, prefix, reserveFor, reserveParams, withConnection } from '../../server/src/config.js';
import { TestWallet } from './test-wallet.js';

const merchant = merchantWallet();
const params = reserveParams(merchant.pkhHex);
const wallet = new TestWallet(prefix);
const customer = wallet.address(DerivationPath.Receive, 0);
// Coins left in the throwaway wallet are not recovered, so keep this small on mainnet.
const START_BALANCE = BigInt(process.env.E2E_START_BALANCE ?? 30_000);
const PAYMENT = 5_000n;
const STAMPS = 5n; // SATS_PER_STAMP_EARNED = 1000

const reserveState = () => withConnection(async (provider) => {
  const utxos = await reserveFor(merchant.pkhHex, provider).getUtxos();
  return {
    sats: utxos.reduce((sum, u) => sum + u.satoshis, 0n),
    stamps: utxos.reduce((sum, u) => sum + (u.token?.amount ?? 0n), 0n),
  };
});
const customerUtxos = () => withConnection((provider) => provider.getUtxos(customer));
const num = (n: bigint) => n.toLocaleString('en-US');

const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;
// Chain round-trips take seconds, so web assertions wait longer than Playwright's default 5s.
const expect = playwrightExpect.configure({ timeout: 60_000 });

let paymentTxid = '';
let browser: Browser;
const open = async (): Promise<Page> => (await browser.newContext({ baseURL })).newPage();

beforeAll(async () => {
  browser = await chromium.launch();
  // Fund the throwaway customer wallet from the merchant's plain coins.
  await withConnection(async (provider) => {
    const coin = (await provider.getUtxos(merchant.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
    await new TransactionBuilder({ provider })
      .addInput(coin, merchant.signer.unlockP2PKH())
      .addOutput({ to: customer, amount: START_BALANCE })
      .addOutput({ to: merchant.address, amount: coin.satoshis - START_BALANCE - 300n })
      .send();
  });
});

afterAll(async () => {
  wallet.close();
  await browser?.close();
});

test('a customer connects, pays, earns stamps and redeems them for BCH', async () => {
  const page = await open();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Get 3% back');
  await expect(page.getByTestId('reserve')).toContainText('sats');
  await expect(page.getByRole('button', { name: 'Redeem for BCH' })).toBeDisabled();

  // Pair over the real WizardConnect relay.
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const uri = await page.getByTestId('pairing').getAttribute('data-uri');
  wallet.connect(uri!);
  await expect(page.getByRole('button', { name: /Test Wallet · Disconnect/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toContainText(`${num(START_BALANCE)} sats`);
  await expect(page.getByTestId('stamps')).toHaveText('0');

  const before = await reserveState();

  // Pay: the wallet signs, the page broadcasts and asks the shop for stamps.
  await page.getByRole('button', { name: `${num(PAYMENT)} sats`, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(`earned ${STAMPS} stamps`);
  await expect(page.getByTestId('stamps')).toHaveText(String(STAMPS));
  paymentTxid = (await page.getByRole('link', { name: 'View transaction' }).getAttribute('href'))!.split('/').pop()!;

  const held = (await customerUtxos()).filter((u) => u.token?.category === params.stampCategory);
  check(held.reduce((sum, u) => sum + u.token!.amount, 0n)).toBe(STAMPS);

  // Redeem through the covenant.
  await page.getByRole('button', { name: 'Redeem for BCH' }).click();
  await expect(page.getByRole('status')).toContainText(/Redeemed \d+ stamps for/);
  await expect(page.getByTestId('stamps')).toHaveText('0');

  const after = await reserveState();
  check(before.sats - after.sats).toBe(STAMPS * params.satsPerStamp);
  check(after.stamps - before.stamps).toBe(STAMPS);
  await expect(page.getByTestId('reserve')).toHaveText(`${num(after.sats)} sats`);
  check((await customerUtxos()).some((u) => u.token)).toBe(false);

  check(wallet.signed).toHaveLength(2);
  check(errors).toEqual([]);
});

test('the issue endpoint never rewards a payment twice and rejects bad requests', async () => {
  const request = (await browser.newContext({ baseURL })).request;
  check(paymentTxid).toMatch(/^[0-9a-f]{64}$/);
  const again = await request.post(`/api/issue?txid=${paymentTxid}`);
  check(again.status()).toBe(200);
  check((await again.json()).issued).toEqual([]);

  check((await request.post('/api/issue?txid=not-a-txid')).status()).toBe(400);
  check((await request.get('/api/issue')).status()).toBe(405);
});

test('the page stays usable when the wallet is disconnected', async () => {
  const page = await open();
  await page.goto('/');
  for (const amount of ['2,000', '5,000', '10,000']) {
    await expect(page.getByRole('button', { name: `${amount} sats`, exact: true })).toBeDisabled();
  }
  await expect(page.getByText('Connect a wallet to pay.')).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText('Scan with your wallet to connect')).toBeVisible();
});

const pair = async (page: Page, w: TestWallet) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  w.connect((await page.getByTestId('pairing').getAttribute('data-uri'))!);
  await expect(page.getByRole('button', { name: /Test Wallet · Disconnect/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toBeVisible();
};

test('a rejected signature shows an error and the next payment still works; stamps from several payments redeem together', async () => {
  const page = await open();
  await pair(page, wallet);
  const signedBefore = wallet.signed.length;
  const before = await reserveState();

  wallet.rejectNext = true;
  await page.getByRole('button', { name: '2,000 sats', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('User rejected the request');
  check(wallet.signed).toHaveLength(signedBefore);
  await expect(page.getByTestId('stamps')).toHaveText('0');

  await page.getByRole('button', { name: '2,000 sats', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('earned 2 stamps');
  await page.getByRole('button', { name: '5,000 sats', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('earned 5 stamps');
  await expect(page.getByTestId('stamps')).toHaveText('7');
  const held = (await customerUtxos()).filter((u) => u.token?.category === params.stampCategory);
  check(held.length).toBe(2); // two separate stamp outputs, redeemed in one transaction

  await page.getByRole('button', { name: 'Redeem for BCH' }).click();
  await expect(page.getByRole('status')).toContainText(/Redeemed \d+ stamps for/);
  await expect(page.getByTestId('stamps')).toHaveText('0');
  const after = await reserveState();
  check(before.sats - after.sats).toBe(7n * params.satsPerStamp);
  check(after.stamps - before.stamps).toBe(7n);
});

test('a wallet without funds gets a clear message instead of a broken transaction', async () => {
  const empty = new TestWallet(prefix);
  const page = await open();
  await pair(page, empty);
  await expect(page.getByTestId('balance')).toContainText('0 sats');
  await page.getByRole('button', { name: '2,000 sats', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('not enough to pay');
  check(empty.signed).toHaveLength(0);
  empty.close();
});

test('a wallet reconnects after a page reload without scanning again', async () => {
  const page = await open();
  await pair(page, wallet);
  await page.reload();
  await expect(page.getByRole('button', { name: /Test Wallet · Disconnect/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toBeVisible();
  await page.getByRole('button', { name: /Disconnect/ }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
});

test('if the shop cannot be reached after paying, the payment still stands and stamps are collected on the next visit', async () => {
  const page = await open();
  await pair(page, wallet);
  await expect(page.getByTestId('stamps')).toHaveText('0');

  await page.route('**/api/issue**', (route) => route.abort());
  await page.getByRole('button', { name: '2,000 sats', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your stamps will arrive shortly');
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await expect(page.getByTestId('stamps')).toHaveText('0');

  // Shop is back: reconnecting triggers a sweep that rewards the earlier payment.
  await page.unroute('**/api/issue**');
  await page.reload();
  await expect(page.getByTestId('stamps')).toHaveText('2');
  await page.getByRole('button', { name: 'Redeem for BCH' }).click();
  await expect(page.getByRole('status')).toContainText(/Redeemed 2 stamps for/);
});
