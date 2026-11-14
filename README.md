# Regulars

Loyalty points that are real money, for shops that accept Bitcoin Cash.

- A customer pays the shop in BCH from any wallet.
- The shop's issuer sees the payment and sends **stamps** (a CashToken) back to the paying address.
- The shop pre-funds a **reward reserve** locked in a covenant. Anyone who hands stamps to the
  reserve takes `satsPerStamp` out per stamp. The shop cannot refuse a redemption.

Built for BCH BLAZE 2026.

## Layout

| Folder | What it is |
|---|---|
| `contracts/` | `RewardReserve.cash` covenant, the shared redeem transaction builder, and tests |
| `server/` | Merchant setup commands, the stateless stamp issuer, and live chipnet checks |
| `web/` | Customer app: connect with WizardConnect, pay, watch stamps arrive, redeem |
| `e2e/` | Browser tests: Chromium driven by Playwright, with a headless WizardConnect wallet |
| `scripts/` | Vercel build (static site + one function for `POST /api/issue`) |

## Run it (chipnet first)

```bash
npm install
npm run compile && npm test
cp .env.example .env
npm run setup -w server -- keygen        # writes a hot key to .env, prints the address to fund
# fund that address from a chipnet faucet (https://tbch.googol.cash), then:
npm run setup -w server -- mint          # creates the stamp token
npm run setup -w server -- split 8       # spreads the supply so simultaneous payments don't queue
npm run setup -w server -- fund 50000    # moves 50,000 sats into the reward reserve
npm run setup -w server -- status
npm run api                              # local stand-in for the /api/issue function
npm run dev                              # web app on http://localhost:5173
```

Mainnet lives in its own file, `.env.mainnet` (copy `.env.example`, set `NETWORK=mainnet` and
`VITE_NETWORK=mainnet`). Prefix any command with `ENV_FILE=.env.mainnet` to use it, e.g.
`ENV_FILE=.env.mainnet npm run setup -w server -- status`. Keep balances small: the merchant key
is a hot key held by the server.

## How stamps are issued

There is no database. An unrewarded payment is an unspent output at the merchant address, and
issuing stamps spends that output, so a payment can never be rewarded twice. `POST /api/issue`
(optionally `?txid=`) rewards whatever is outstanding; the web app calls it after each payment and
on connect. `npm run issuer` runs the same sweep in a loop for payments made from other wallets.

## Tests

```bash
npm test                          # covenant, on CashScript's mock network
npm test -w server                # payment parsing
npm run test:e2e                  # browser flow on chipnet (spends test coins from .env)
npm run e2e -w server             # pay → stamps → redeem, without a browser
npm run e2e:concurrent -w server  # four customers at once, exactly-once issuing
E2E_BASE_URL=https://your-site npm run test:e2e   # same browser tests against a deployment
```

## Deploy

```bash
npm run deploy                         # chipnet build
ENV_FILE=.env.mainnet npm run deploy   # mainnet build
```

The Vercel project needs `NETWORK`, `MERCHANT_WIF`, `STAMP_CATEGORY` and `SATS_PER_STAMP_EARNED`
as production environment variables. The `VITE_*` values are baked into the site at build time.

## How the covenant works

`redeem()` checks, for the reserve's own input index `i`:

1. output `i` has the same locking script (the reserve is recreated),
2. output `i` holds this shop's stamp category,
3. the stamp balance grew by `N > 0`,
4. the BCH balance fell by at most `N * satsPerStamp`.

`withdraw()` needs the merchant's signature and is how the shop reclaims BCH and collected stamps.

## Known limits

- One reserve UTXO serves one redemption at a time; concurrent redeemers must retry. Splitting the
  reserve across several UTXOs removes the contention.
- Stamps go to the address of the payment's first input, so the payer must use a standard P2PKH wallet.
- Redeeming only part of a stamp balance needs about 1,000 sats of reward to cover the fee and the
  change output. Redeeming a whole balance always works, which is what the web app does.
- The issuer is trusted to hand out stamps; only redemption is trustless.
- Payments made outside the web app are rewarded the next time anything calls `/api/issue`
  (a page visit, a cron job, or `npm run issuer`).
- Each stamp issuance leaves 1,000 sats with the stamps as the token output's minimum value; the
  customer gets it back when redeeming.
