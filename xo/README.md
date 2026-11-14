# Regulars XO template

An XO template for the two Regulars covenants, so any XO wallet can pay a shop and earn its stamps,
then redeem them, with the engine building every transaction from the template.

- Template: [`regulars.template.json`](regulars.template.json) (generated from [`src/template.ts`](src/template.ts))
- Invitations executed on chipnet: [`invitations/earn-chipnet.txt`](invitations/earn-chipnet.txt), [`invitations/redeem-chipnet.txt`](invitations/redeem-chipnet.txt)

| Action | Chipnet transaction |
|---|---|
| `earn` | `d50bb7601c961d379b9bed0f4a02847a3b3304de9bb2e48d3ec6c3943ce8ce7a` |
| `redeem` (follow-up) | `f6a79ac0d07af2a05a1717981e4e9b8813d5d37e7647e0d07158502af6f6396c` |

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

The runner creates a disposable XO account (its mnemonic goes into `.env`), funds it with 30,000
chipnet sats from the owner key, imports the P2PKH and Regulars templates, then for each action:
`createInvitation` → `appendInvitation` (outputs) → `addChangeToInvitation` → `signInvitation` →
`executeAction`. Each executed invitation is serialised with `serializeInvitation` into
`invitations/`.

To inspect one in the XO debug tool (https://blaze.xo.cash), use a disposable account there,
import `regulars.template.json`, and load the invitation text.

## Limitations

- The engine only compiles unlocking bytecode for outputs its own account tracks, and there is no
  call to track a covenant someone else created. Both covenant inputs take no signature, so the
  runner supplies their unlocking bytecode, `OP_0 <redeem script>`, with the input. That is
  exactly the template's `issuerEarnUnlockingBytecode` / `reserveRedeemUnlockingBytecode`.
- The engine runs on its default IndexedDB storage, provided in Node by `fake-indexeddb`, so the
  account's state lasts for one run. The SQLite backend in engine `0.1.1-next.17778370827` fails
  at start-up (`State.listScriptHashes` is missing from the adapter).
- `redeem` declares the reserve input as holding stamps, so it expects a reserve that has already
  been redeemed against at least once (true for the demo shops). A brand-new reserve holds no
  tokens and would need a second variant of the input.
