import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { secp256k1, hash160, decodeBase58Address, decodeTransaction, encodeTransaction, binToHex, hexToBin, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { TransactionBuilder, SignatureTemplate, MockNetworkProvider } from 'cashscript';
import {
  addressOfPublicKey, addressOfPkh, parseAddress, signMessage, verifyMessage, commitmentScript, txidOf,
  verificationText, identityEvent, verifyIdentity, claimsOf, createChallenge, authEvent, verifyAuth,
} from '../src';

const bchKey = (network: 'mainnet' | 'chipnet' = 'mainnet') => { const k = generateSecretKey(); return { priv: k, address: addressOfPublicKey(secp256k1.derivePublicKeyCompressed(k) as Uint8Array, network) }; };
// The mock network that builds test transactions uses chipnet addresses.
const testnetKey = () => bchKey('chipnet');
const nostrKey = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };

describe('addresses', () => {
  it('normalises prefix, case and token-aware forms to one canonical address', () => {
    const { address } = bchKey();
    const bare = address.split(':')[1];
    expect(parseAddress(bare.toUpperCase()).address).toBe(address);
    expect(parseAddress(address).pkh).toHaveLength(40);
  });
  it('rejects non-P2PKH', () => {
    expect(() => parseAddress('bitcoincash:pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toThrow();
  });
});

describe('signed messages', () => {
  it('round-trips and rejects the wrong address or message', () => {
    const a = bchKey(), b = bchKey();
    const sig = signMessage(a.priv, 'hello');
    expect(verifyMessage(a.address, 'hello', sig)).toBe(true);
    expect(verifyMessage(b.address, 'hello', sig)).toBe(false);
    expect(verifyMessage(a.address, 'hello!', sig)).toBe(false);
    expect(verifyMessage(a.address, 'hello', 'not base64')).toBe(false);
  });
  it('verifies the published bitcoinjs-message vector (same format as Electron Cash)', () => {
    const legacy = decodeBase58Address('1HZwkjkeaoZfTSaJxDw6aKkxp45agDiEzN');
    if (typeof legacy === 'string') throw new Error(legacy);
    const address = addressOfPkh(legacy.payload, 'mainnet');
    const signature = 'G9L5yLFjti0QTHhPyFrZCT1V/MMnBtXKmoiKDZ78NDBjERki6ZTQZdSMCtkgoNmp17By9ItJr8o7ChX0XxY91nk=';
    expect(verifyMessage(address, 'This is an example of a signed message.', signature)).toBe(true);
    expect(verifyMessage(address, 'This is an example of a signed message!', signature)).toBe(false);
  });
});

describe('binding with a signed message', () => {
  it('verifies when both keys agree', async () => {
    const bch = bchKey(), nostr = nostrKey();
    const sig = signMessage(bch.priv, verificationText(nostr.pk));
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'msg', signature: sig } }]), nostr.sk);
    const v = await verifyIdentity(event);
    expect(v.signed).toBe(true);
    expect(v.verified).toEqual([bch.address]);
    expect(v.npub).toBe(nip19.npubEncode(nostr.pk));
  });
  it('rejects a proof copied into another Nostr key\'s event', async () => {
    const bch = bchKey(), victim = nostrKey(), thief = nostrKey();
    const sig = signMessage(bch.priv, verificationText(victim.pk));
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'msg', signature: sig } }]), thief.sk);
    expect((await verifyIdentity(event)).verified).toEqual([]);
  });
  it('rejects claiming someone else\'s address with your own signature', async () => {
    const mine = bchKey(), theirs = bchKey(), nostr = nostrKey();
    const sig = signMessage(mine.priv, verificationText(nostr.pk));
    const event = finalizeEvent(identityEvent([{ address: theirs.address, proof: { type: 'msg', signature: sig } }]), nostr.sk);
    expect((await verifyIdentity(event)).verified).toEqual([]);
  });
  it('rejects a tampered event', async () => {
    const bch = bchKey(), nostr = nostrKey();
    const sig = signMessage(bch.priv, verificationText(nostr.pk));
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'msg', signature: sig } }]), nostr.sk);
    const other = bchKey();
    event.tags.push(['i', `bch:${other.address}`, `msg:${signMessage(other.priv, verificationText(nostr.pk))}`]);
    const v = await verifyIdentity(event);
    expect(v.signed).toBe(false);
    expect(v.verified).toEqual([]);
  });
  it('keeps the user\'s other NIP-39 claims and replaces an old proof for the same address', () => {
    const bch = bchKey();
    const keep = [['i', 'github:alice', 'gist123'], ['i', `bch:${bch.address}`, 'msg:old']];
    const template = identityEvent([{ address: bch.address, proof: { type: 'tx', txid: 'ab'.repeat(32) } }], keep);
    expect(template.tags).toEqual([['i', 'github:alice', 'gist123'], ['i', `bch:${bch.address}`, `tx:${'ab'.repeat(32)}`]]);
  });
});

describe('binding with an on-chain commitment', () => {
  // A funding transaction paying the BCH key, and a commitment transaction spending it with the text in OP_RETURN.
  async function commit(bch: ReturnType<typeof bchKey>, text: string) {
    const lock = cashAddressToLockingBytecode(bch.address);
    if (typeof lock === 'string') throw new Error(lock);
    const funding = {
      version: 2, locktime: 0,
      inputs: [{ outpointIndex: 0, outpointTransactionHash: new Uint8Array(32).fill(7), sequenceNumber: 0xffffffff, unlockingBytecode: Uint8Array.of(0x51) }],
      outputs: [{ lockingBytecode: lock.bytecode, valueSatoshis: 10_000n }],
    };
    const fundingId = txidOf(funding);
    const provider = new MockNetworkProvider();
    const builder = new TransactionBuilder({ provider })
      .addInput({ txid: fundingId, vout: 0, satoshis: 10_000n, lockingBytecode: binToHex(lock.bytecode) } as never, new SignatureTemplate(bch.priv).unlockP2PKH())
      .addOutput({ to: commitmentScript(text), amount: 0n })
      .addOutput({ to: bch.address, amount: 9_500n });
    const hex = builder.build();
    const txs = new Map([[fundingId, binToHex(encodeTransaction(funding))], [txidOf(decode(hex)), hex]]);
    return { txid: txidOf(decode(hex)), fetchTx: async (id: string) => { const t = txs.get(id); if (!t) throw new Error('unknown'); return t; } };
  }
  const decode = (hex: string) => { const tx = decodeTransaction(hexToBin(hex)); if (typeof tx === 'string') throw new Error(tx); return tx; };

  it('verifies a commitment spent from the claimed address', async () => {
    const bch = testnetKey(), nostr = nostrKey();
    const { txid, fetchTx } = await commit(bch, verificationText(nostr.pk));
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'tx', txid } }]), nostr.sk);
    const v = await verifyIdentity(event, { fetchTx });
    expect(v.claims[0].reason).toBeUndefined();
    expect(v.verified).toEqual([bch.address]);
  });
  it('rejects a commitment to a different npub', async () => {
    const bch = testnetKey(), nostr = nostrKey(), other = nostrKey();
    const { txid, fetchTx } = await commit(bch, verificationText(other.pk));
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'tx', txid } }]), nostr.sk);
    expect((await verifyIdentity(event, { fetchTx })).claims[0].reason).toMatch(/verification text/);
  });
  it('rejects a commitment spent from a different address', async () => {
    const bch = testnetKey(), claimed = testnetKey(), nostr = nostrKey();
    const { txid, fetchTx } = await commit(bch, verificationText(nostr.pk));
    const event = finalizeEvent(identityEvent([{ address: claimed.address, proof: { type: 'tx', txid } }]), nostr.sk);
    expect((await verifyIdentity(event, { fetchTx })).claims[0].reason).toMatch(/not spent from/);
  });
  it('rejects a server that answers with the wrong transaction', async () => {
    const bch = testnetKey(), nostr = nostrKey();
    const { txid, fetchTx } = await commit(bch, verificationText(nostr.pk));
    const liar = async (id: string) => (id === txid ? (await commit(testnetKey(), 'x')).fetchTx((await commit(testnetKey(), 'x')).txid) : fetchTx(id));
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'tx', txid } }]), nostr.sk);
    expect((await verifyIdentity(event, { fetchTx: liar })).verified).toEqual([]);
  });
  it('lists claims in the event', () => {
    const bch = testnetKey(), nostr = nostrKey();
    const event = finalizeEvent(identityEvent([{ address: bch.address, proof: { type: 'tx', txid: 'cd'.repeat(32) } }]), nostr.sk);
    expect(claimsOf(event)).toEqual([{ address: bch.address, proof: { type: 'tx', txid: 'cd'.repeat(32) } }]);
  });
});

describe('challenge-response sign-in', () => {
  const origin = 'https://regulars-bch.vercel.app';
  it('accepts a fresh answer to the right challenge for the right app', () => {
    const nostr = nostrKey(), challenge = createChallenge();
    const answer = finalizeEvent(authEvent(challenge, origin), nostr.sk);
    expect(verifyAuth(answer, challenge, origin)).toEqual({ ok: true, pubkey: nostr.pk });
  });
  it('rejects a replayed challenge, another app, an old answer, or a forged signature', () => {
    const nostr = nostrKey(), challenge = createChallenge();
    const answer = finalizeEvent(authEvent(challenge, origin), nostr.sk);
    expect(verifyAuth(answer, createChallenge(), origin).ok).toBe(false);
    expect(verifyAuth(answer, challenge, 'https://evil.example').ok).toBe(false);
    const old = finalizeEvent({ ...authEvent(challenge, origin), created_at: Math.floor(Date.now() / 1000) - 3600 }, nostr.sk);
    expect(verifyAuth(old, challenge, origin).reason).toMatch(/too old/);
    expect(verifyAuth({ ...answer, pubkey: nostrKey().pk }, challenge, origin).ok).toBe(false);
  });
});

void hash160;
