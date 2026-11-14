# Regulars

Loyalty points that are real money: a loyalty protocol on Bitcoin Cash with no backend.

Live on mainnet: https://regulars-bch.vercel.app · Presentation: https://regulars-bch.vercel.app/deck.html

- A customer pays a shop in BCH and receives **stamps** (a CashToken) **in the same transaction**.
- Stamps are redeemable for BCH from a **reward reserve** the shop locks up front. The shop cannot
  refuse a redemption.
- Any shop opens its programme with **one transaction** from its own wallet, then shares a link or
  prints a QR poster.

Two contracts and a static web page. No server, no database, no key held by anyone but the shop
and its customers. Built for BCH BLAZE 2026.

## How it works

**`StampIssuer`** holds a shop's unissued stamps. `earn()` lets anyone take N stamps provided that,
in the same transaction:

1. the issuer is recreated at output 0 with N fewer stamps,
2. output 1 pays the shop at least `N × (satsPerStampEarned − feePerStamp)`,
3. the issuer's own balance grows by `N × feePerStamp` (the protocol fee).

`collect()` lets anyone forward accrued fees, but only to the protocol treasury. `withdraw()` lets
the shop reclaim unissued stamps; accrued fees still go to the treasury.

**`RewardReserve`** holds the shop's reward BCH. `redeem()` checks that the reserve is recreated,
that its stamp balance grew by N, and that at most `N × satsPerStamp` left. `withdraw()` is the
shop closing the reserve.

A shop is fully described by five values (name, token category, shop key hash, earn rate, redeem
rate), and both contract addresses follow from them. So a shop *is* its link:
`/#/s/<name>/<category>/<merchantPkh>/<earn>/<redeem>`. Nothing is registered anywhere.

## Layout

| Folder | What it is |
|---|---|
| `contracts/` | The two covenants, the shared transaction builders, and tests |
| `web/` | The site: home, shop page, open-a-shop form, printable poster |
| `cli/` | Owner tools (open the demo shop, status, collect fees) and a live multi-customer check |
| `e2e/` | Browser tests: Chromium driven by Playwright, with a headless WizardConnect wallet |
| `scripts/` | Vercel static build |

## Run it

```bash
npm install
npm run compile && npm test       # 23 covenant tests on CashScript's mock network
cp .env.example .env
npm run shop -- keygen            # writes a key to .env, prints the address to fund
# fund it from a chipnet faucet (https://tbch.googol.cash), then:
npm run shop -- open "Demo Café" 100000
npm run shop -- status
npm run dev                       # http://localhost:5173
```

Mainnet uses its own file: copy `.env.example` to `.env.mainnet`, set `NETWORK=mainnet` and
`VITE_NETWORK=mainnet`, and prefix commands with `ENV_FILE=.env.mainnet`.

The key in `.env` owns the demo shop, receives protocol fees and funds test wallets. The deployed
site never sees it.

## Tests

```bash
npm test                 # covenants: happy paths and attacks
npm run test:e2e         # browser flows on chipnet (spends test coins from .env)
npm run e2e -w cli       # several customers paying at once, then a redemption
E2E_BASE_URL=https://your-site npm run test:e2e   # the same browser tests against a deployment
```

The browser suite pairs a headless wallet over the real WizardConnect relay and covers: pay and
earn, redeem, a rejected signature, an empty wallet, reconnecting after reload, a merchant opening
a shop from the UI, the poster, and broken links.

## Deploy

```bash
npm run deploy                         # chipnet build
ENV_FILE=.env.mainnet npm run deploy   # mainnet build
```

The output is static files only. No environment variables are needed on the host.

## Known limits

- Stamps are earned only by paying through the shop page (or any wallet that builds the same
  transaction). A plain payment scanned from an ordinary address QR earns nothing.
- Each issuer output serves one payment at a time; a shop has eight, and a customer who loses a
  race is asked to try again without being charged.
- Along with their stamps a customer's wallet sends 1,000 sats, the minimum a token output can
  hold. It comes back on redemption.
- The site reads the first 10 receive and 10 change addresses of the connected wallet.
- Shop links are self-describing, so a link can be crafted for a different shop with the same
  name. Customers should get the link or poster from the shop itself.
- Closing a shop (`withdraw`) is implemented and tested in the contracts but has no button yet.
