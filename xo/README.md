# Regulars XO template

An XO template for the two Regulars covenants, so any XO wallet can pay a shop and earn its stamps,
then redeem them, with the engine building every transaction from the template.

- Template: [`regulars.template.json`](regulars.template.json) (generated from [`src/template.ts`](src/template.ts))
- Invitations executed on chipnet: [`invitations/earn-chipnet.txt`](invitations/earn-chipnet.txt), [`invitations/redeem-chipnet.txt`](invitations/redeem-chipnet.txt)

| Action | Chipnet transaction |
|---|---|
| `earn` (20 stamps) | `3f72c8060ce6a7505994c8c3289c178c4efb2536cf837f176c94f804be1bbe84` |
| `redeem` (follow-up, 20 stamps) | `5797d657f1bc379dd24bf5867165b1f7c77e9e6fd27f8aae806cc265ff06c4c5` |

Built with `@xo-cash/engine@0.1.1-next.18029697917`. The template was first executed on
`0.1.1-next.17778370827` (earn `d50bb760…ce8ce7a`, redeem `f6a79ac0…f6f6396c`) and re-run after the
upgrade.

## What the template describes

**Role:** `customer`.

**`earn`** (a start action) spends one `StampIssuer` output at input 0 and builds:

| Output | Locking script | Value | Tokens |
|---|---|---|---|
| 0 `issuerOutput` | `issuerLockingScript` (P2SH32 of the issuer covenant) | issuer sats + stamps × fee | issuer stamps − stamps |
| 1 `shopPaymentOutput` | `shopLockingScript` (the shop's P2PKH) | stamps × (sats per stamp − fee) | none |
| `stampsOutput` | `stampsLockingScript` (P2PKH of a key the engine generates) | 1,000 | stamps |

The customer's own coins pay for it, and the engine adds change.

**`redeem`** is the **follow-up action** on `stampsLockingScript`: an output received from `earn`
offers `redeem` to the customer role that holds its key. It spends the `RewardReserve` output at
input 0 plus the stamps, recreates the reserve at output 0 with the stamps added and
`stamps × reward` fewer sats, and the engine returns the reward to the customer as change.

**Variables** are the five values in a Regulars shop link (stamp category, shop key hash, earn
rate, redeem rate) plus the protocol fee settings and the current state of the contract output
being spent. The engine cannot discover covenant outputs by itself, so the caller (the web app, or
`src/run.ts`) supplies them, as the faucet.cash template does.

## The scripts are the deployed covenants

`src/template.ts` builds the redeem scripts from the CashScript artifacts in `contracts/`:
constructor arguments pushed last-first, then the compiled bytecode with data pushes written as
`<0x…>`. The stamp category is pushed through `OP_REVERSEBYTES`, because introspection sees token
categories in the opposite byte order from wallets.

Before broadcasting, `src/run.ts` asks the engine for the locking bytecode it built for the
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
```

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
- `redeem` declares the reserve input as holding stamps, so it expects a reserve that has already
  been redeemed against at least once (true for the demo shops). A brand-new reserve holds no
  tokens and would need a second variant of the input.
- A redemption must be worth more than the network fee plus the 546-sat dust limit, or
  `addChangeToInvitation` throws `ChangeSatoshisBelowDustError`. The runner earns and redeems 20
  stamps (600 sats) for that reason.
