# bch-nostr-id

Self-sovereign identity that links a **Bitcoin Cash address** to a **Nostr key**, built only from
existing open standards: NIP-39 identity claims, the Bitcoin Signed Message format, NIP-42-style
challenge-response, and plain BCH transactions. No identity server, no database, no custodian.

Built for the BCH BLAZE 2026 *Decentralized Identity* bounty (sponsored by Paytaca), and used live in
[Regulars](https://regulars-bch.vercel.app/#/app/identity).

| Bounty requirement | How it's met |
|---|---|
| Identity creation & management | The user's own Nostr key (NIP-07 extension, or a key created in the browser that they can back up) and their own BCH wallet. Nothing is custodied. |
| Cryptographic binding | Two signatures, one per key, each naming the other identity. Keys are never shared or reused. |
| Decentralized discovery | A NIP-39 event on public Nostr relays, findable by npub, by NIP-05 name, or in reverse by BCH address. |
| Verification & authentication | `verifyIdentity()` checks everything locally. `createChallenge` / `authEvent` / `verifyAuth` sign users in with challenge-response. |
| Demo & docs | [Identity page](https://regulars-bch.vercel.app/#/app/identity), [Verify page](https://regulars-bch.vercel.app/#/app/id), [sign-in demo](https://regulars-bch.vercel.app/#/signin-demo), this spec. |

Stretch goals covered: **pay by identity** (send BCH to a verified npub without exchanging addresses),
**merchant verification** (shop pages show who runs the shop), **portable reputation** (an identity
shows the loyalty stamps its verified addresses hold), **BCH-backed commitments** (on-chain proofs),
and a **reusable library**.

## The binding

A user publishes a NIP-39 identity-claims event (kind `10011`, replaceable) signed by their Nostr key.
Each BCH address is one `i` tag:

```json
{
  "kind": 10011,
  "pubkey": "<nostr pubkey>",
  "tags": [
    ["i", "bch:bitcoincash:qpawd824unlasajjmzghggdnc752d0decy5pyaaswp", "msg:Hy9Ru8ld…mFc="],
    ["i", "bch:bitcoincash:qz…", "tx:4f1c…e2a9"],
    ["i", "github:alice", "<gist id>"]
  ],
  "content": "",
  "sig": "<schnorr signature by the Nostr key>"
}
```

- **Platform:** `bch`. **Identity:** a P2PKH cash address, canonical form (lowercase, with prefix, non-token).
- **Verification text:** the NIP-39 text, `Verifying that I control the following Nostr public key: <npub>`.
- **Proof**, one of:
  - `msg:<base64>`: the BCH key's signature over the verification text in the standard *Bitcoin Signed
    Message* format, which Electron Cash, Paytaca and most BCH wallets produce with "Sign message".
  - `tx:<txid>`: a transaction on chain that spends a coin from the address and carries the
    verification text in an OP_RETURN output. This is for wallets that can sign transactions but not
    messages (WizardConnect wallets today). It also gives the binding a timestamp on chain. It costs
    only the network fee (about 300 sats), because the coin goes back to the same address.

Other `i` tags (GitHub, X…) are kept untouched when the list is republished.

### Why this is a two-way binding

1. The **Nostr signature** covers the `i` tag, so the Nostr key claims the address.
2. The **BCH proof** contains the npub, so the BCH key claims the Nostr key.

Neither key can create the binding alone. Copying someone's BCH proof into your own event fails at
step 2, because the proof names their npub, not yours. Claiming someone else's address with your own
signature fails because the signature recovers to a different key.

### Verifying (`verifyIdentity`)

1. The event is kind `10011` and its Schnorr signature is valid. The check runs on a fresh copy of
   the signed fields, because nostr-tools caches a passed check on the event object.
2. For each `bch:` claim:
   - `msg:` Recover the public key from the signature over the verification text. Its hash160 must
     equal the address's key hash.
   - `tx:` Fetch the transaction, re-hash it and check the txid matches. It must have an OP_RETURN with
     the exact verification text and a P2PKH input whose public key hashes to the address. Then fetch
     every coin it spends and **re-run the transaction in the BCH virtual machine**, so a lying server
     cannot vouch for a forged transaction.

### Discovery

- By key: `findByPubkey(npub | hex | nprofile | name@domain)`. NIP-05 names are resolved first.
- By address: `findByAddress(cashaddr)` queries relays with `{"kinds":[10011], "#i":["bch:<cashaddr>"]}`.
  Anyone can *claim* an address, so only identities whose proof verifies are returned.
- Default relays: nos.lol, relay.primal.net, relay.damus.io, relay.snort.social, offchain.pub,
  relay.nostr.net. Any NIP-01 relay works.

### Sign-in (challenge-response)

1. The app calls `createChallenge()` (16 random bytes) and shows it.
2. The user signs `authEvent(challenge, appOrigin)`: a kind-`22242` event with `relay` and `challenge`
   tags, the canonical NIP-42 shape.
3. The app calls `verifyAuth(event, challenge, appOrigin)`. The event must be signed, answer this
   challenge, name this app, and be under 10 minutes old.
4. The app looks up the pubkey's binding with `findByPubkey` and knows the user's verified BCH wallet.
   No central authority is contacted.

## Use it

```ts
import { verificationText, signMessage, identityEvent, publish, findByAddress, findByPubkey } from '@regulars/bch-nostr-id';
import { finalizeEvent } from 'nostr-tools';

// Bind: sign the text with the BCH key (or have a wallet do it), sign the event with the Nostr key.
const proof = { type: 'msg', signature: signMessage(bchPrivateKey, verificationText(nostrPubkey)) } as const;
await publish(finalizeEvent(identityEvent([{ address, proof }]), nostrSecretKey));

// Discover and verify, from anywhere.
const [owner] = await findByAddress('bitcoincash:q…', { fetchTx });
const identity = await findByPubkey('npub1…', { fetchTx });
identity?.verified; // addresses whose binding passed every check
```

`fetchTx(txid)` returns raw transaction hex. Any Electrum server or block explorer can provide it, and
you only need it for `tx:` proofs.

## Tests

```bash
npm test -w identity
```

16 tests cover:

- Address normalisation.
- Signed-message round trips, plus the published bitcoinjs-message test vector, which shows the
  format matches what wallets produce.
- Binding happy paths.
- Copied proofs, swapped addresses and tampered events.
- On-chain commitments: valid, wrong npub, wrong address, and a server returning the wrong
  transaction.
- Challenge-response: replay, wrong app, stale and forged answers.

## Known limits and next steps

- **Key rotation and recovery** are not built yet. A natural design is a rotation event signed by
  both the old and new Nostr keys, plus a fresh BCH proof.
- A `tx:` proof is checked against the transaction's own signatures, not against block headers. A
  verifier that also wants proof of confirmation can check its depth with an SPV header chain.
- Selective disclosure is out of scope. The binding only reveals what is in the event: the address
  and the npub.
