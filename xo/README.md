# Regulars XO template

An XO template for the two Regulars covenants with both sides of the protocol: a **shop** can open,
get paid and close through XO, and a **customer** can pay, earn stamps and redeem them. The engine
builds every transaction from the template.

- Template: [`regulars.template.json`](regulars.template.json) (generated from [`src/template.ts`](src/template.ts))
- Invitations executed on chipnet, one file per action in [`invitations/`](invitations)

**Customer, against the live demo shop** (`npm run run:chipnet -w xo`)

| Action | Chipnet transaction |
|---|---|
| `earn` (20 stamps) | `44c3c1f3e8921d365437e047d74534f4c3edaffa83efc1277d87559bb47915f4` |
| `redeem` (follow-up, 20 stamps) | `73d3e88ca07e0daa7754987538a8fc2cbf7f8bbcec62fcd3625256bfc0797717` |

**A shop's whole life, opened and closed through XO** (`npm run run:merchant -w xo`)

| Action | Role | Chipnet transaction |
|---|---|---|
| `openShop`: mint 100,000 stamps, lock a 5,000-sat reserve | shop | `b04825af73c2389f7f70da927472cfc3de20f2074f308c20037a47d2d156052d` |
| `earn` at the new shop (20 stamps) | customer | `b82a297cb5b8d5cb2c936488f7727332827208d1961d4505bfc77591e0720129` |
| `redeemFresh`: first redemption, against a reserve holding no stamps | customer | `a41b5fe2c06e9af30f65d01086759fc78f3076c9dcc45b79e531875d1773debf` |
| `closeIssuer` (follow-up on the issuer, shop key signs) | shop | `a269f2148903ff165566d474af708527f62ef1443d06f7271571e0990fe881cc` |
| `withdrawReserve` (follow-up on the reserve, shop key signs) | shop | `61abb8b222acfdfe05e3a7308aaf9db8d3a3302fae7ec992f31083ce46393f96` |

Built with `@xo-cash/engine@0.1.1-next.18029697917`. The template was first executed on
`0.1.1-next.17778370827` (earn `d50bb760…ce8ce7a`, redeem `f6a79ac0…f6f6396c`) and re-run after the
upgrade.

## What the template describes

**Roles:** `customer` and `merchant` (the shop).

### Shop

**`openShop`** (a start action) generates the **shop key** in the XO account and, in one
transaction, mints the stamp supply into an issuer contract (output 0), locks the reward reserve
(output 1) and writes an announcement (output 2): `OP_RETURN "RGLR" <shop key hash> <name>`. The
stamps' category is the txid of the coin spent at input 0, so the runner passes an output-0 coin
there. With the category (this transaction's input 0) and the announcement, anyone can rebuild the
shop link.

The two contracts appear twice in the template. Customers use `issuerLockingScript` /
`reserveLockingScript`, built from the key hash as a plain variable. The shop uses
`shopIssuerLockingScript` / `shopReserveLockingScript`, built from `merchantKey.public_key`, which
compile to the same bytes. Because the shop's versions keep the key as role state, the engine
tracks the contracts for the shop and offers two **follow-up actions** on them:

- **`closeIssuer`** spends an issuer output with `withdraw(merchantPk, merchantSig)`
  (`<merchantKey.schnorr_signature.all_outputs> <merchantKey.public_key> OP_2`; P2SH appends the
  redeem script). Unissued stamps are burned, and `protocolFeeOutput` forwards accrued fees when the
  output holds more than 3,000 sats, as the covenant requires.
- **`withdrawReserve`** does the same for the reserve (selector `OP_1`).

Both return the BCH to the shop key through `shopRefundOutput`. Payments to the shop
(`shopPaymentOutput` in `earn`) go to the same key, which the shop tracks as `shopKeyLockingScript`.

### Customer

**`earn`** (a start action) spends one `StampIssuer` output at input 0 and builds:

| Output | Locking script | Value | Tokens |
|---|---|---|---|
| 0 `issuerOutput` | `issuerLockingScript` (P2SH32 of the issuer covenant) | issuer sats + stamps × fee | issuer stamps − stamps |
| 1 `shopPaymentOutput` | `shopLockingScript` (the shop's P2PKH) | stamps × (sats per stamp − fee) | none |
| `stampsOutput` | `stampsLockingScript` (P2PKH of a key the engine generates) | 1,000 | stamps |

The customer's own coins pay for it, and the engine adds change.

**`redeem`** and **`redeemFresh`** are the **follow-up actions** on `stampsLockingScript`: an output received from `earn`
offers `redeem` to the customer role that holds its key. It spends the `RewardReserve` output at
input 0 plus the stamps, recreates the reserve at output 0 with the stamps added and
`stamps × reward` fewer sats, and the engine returns the reward to the customer as change.
`redeemFresh` is the same for a reserve nobody has redeemed against yet, whose input holds no
tokens.

**Variables** are the five values in a Regulars shop link (stamp category, shop key hash, earn
rate, redeem rate) plus the protocol fee settings and the current state of the contract output
being spent. The engine cannot discover covenant outputs by itself, so the caller (the web app, or
`src/run.ts`) supplies them, as the faucet.cash template does.

## The scripts are the deployed covenants

`src/template.ts` builds the redeem scripts from the CashScript artifacts in `contracts/`:
constructor arguments pushed last-first, then the compiled bytecode with data pushes written as
`<0x…>`. The stamp category is pushed through `OP_REVERSEBYTES`, because introspection sees token
categories in the opposite byte order from wallets.

Before broadcasting, the runners ask the engine for the locking bytecode it built for the
issuer and reserve outputs and refuses to continue unless it equals the CashScript contract's. It
also decodes the engine's transaction and runs it through the libauth BCH VM. Both checks passed
for the transactions above.

## Reproduce the invitations

```bash
npm install
npm run compile
# chipnet .env with a funded owner key and an open demo shop (see the main README):
npm run shop -- keygen
npm run shop -- open "Demo Café" 100000
npm run template -w xo      # writes regulars.template.json
npm run run:chipnet -w xo   # earn, then redeem, through XO invitations
npm run run:merchant -w xo  # open a shop, earn, redeemFresh, closeIssuer, withdrawReserve
```

`run:merchant` reads the shop key hash from the `openShop` announcement before broadcasting, rebuilds
both contracts with CashScript, and refuses to go on unless XO's outputs 0 and 1 match them byte for
byte.

The runner creates a disposable XO account (its mnemonic goes into `.env`), funds it with 60,000
chipnet sats from the owner key when it runs low, imports the P2PKH and Regulars templates, then for each action:
`createInvitation` → `appendInvitation` (outputs) → `addChangeToInvitation` → `signInvitation` →
`executeAction`. `redeem` spends every stamps output the account holds. Each executed invitation is serialised with `serializeInvitation` into
`invitations/`.

To inspect one in the XO debug tool (https://blaze.xo.cash), use a disposable account there,
import `regulars.template.json`, and load the invitation text.

## Limitations

Re-checked on engine `0.1.1-next.18029697917`.

- The engine signs only inputs its own account tracks, and the two contracts were created by the
  shop. They need no signature, so (as the XO team recommends) the runner compiles the template's
  own `issuerEarnUnlockingBytecode` / `reserveRedeemUnlockingBytecode` with `compileCashAssemblyString`
  from `@xo-cash/utils` and passes the result as the input's `unlockingBytecode`. Byte-typed values
  must be given to that compiler as `Uint8Array` (a hex string is pushed as its text), with
  `evaluationDecodeMode: 'hex'`. The runner also checks the result equals CashScript's
  `OP_0 <redeem script>` before broadcasting.
- An output locking script written as a CashAssembly evaluation that concatenates,
  `$(<0x76a914> <merchantPkh> OP_CAT <0x88ac> OP_CAT)`, resolves to the wrong bytes
  (`0000db1e…fd0a00` instead of `76a914bdb1e0…fda88ac`). The template writes the shop's P2PKH
  directly as a `p2s` locking script instead, which resolves correctly. `compileCashAssemblyString`
  produces the right bytes for the same script with `evaluationDecodeMode: 'hex'` and `Uint8Array`
  values, but its default decode mode reads the result as UTF-8 text, which would explain the
  mangled output.
- The engine uses IndexedDB, its supported storage; in Node it is provided by `fake-indexeddb`,
  so the account's state lasts for one run. (The SQLite option is not supported yet, per the XO
  team.)
- The engine budgets a flat 160 sats per input, but a contract input carries its whole redeem
  script, so `closeIssuer` / `withdrawReserve` fell short of the relay fee. The merchant runner sizes
  the transaction itself (what XO built, plus each input's unlocking script) and sets the refund
  output to everything else, instead of using `addChangeToInvitation`.
- One XO account playing both roles tracks the shop's contracts too, so the engine lists the
  issuer/reserve input as its own in `earn` and `redeem`. The runners skip signing the inputs they
  already compiled.
- `openShop` mints into one issuer output. The web app opens shops with eight, so simultaneous
  customers do not queue; the template would need a repeated output for that.
- A redemption must be worth more than the network fee plus the 546-sat dust limit, or
  `addChangeToInvitation` throws `ChangeSatoshisBelowDustError`. The runner earns and redeems 20
  stamps (600 sats) for that reason.
