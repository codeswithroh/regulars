import { describe, it, expect } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo } from 'cashscript';
import { secp256k1, hash160, encodeCashAddress, generatePrivateKey } from '@bitauth/libauth';
import { readPayment, stampsEarned } from '../src/payments.js';

const wallet = () => {
  const priv = generatePrivateKey();
  const pkh = hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
  const addr = (type: 'p2pkh' | 'p2pkhWithTokens') => encodeCashAddress({ prefix: 'bchtest', type, payload: pkh, throwErrors: true }).address;
  return { pkh, address: addr('p2pkh'), tokenAddress: addr('p2pkhWithTokens'), signer: new SignatureTemplate(priv) };
};

describe('readPayment', () => {
  const provider = new MockNetworkProvider();
  const merchant = wallet();
  const customer = wallet();
  const pay = (from: ReturnType<typeof wallet>, to: string, amount: bigint) => {
    const utxo = provider.addUtxo(from.address, randomUtxo({ satoshis: 50_000n }));
    return new TransactionBuilder({ provider })
      .addInput(utxo, from.signer.unlockP2PKH())
      .addOutput({ to, amount })
      .addOutput({ to: from.address, amount: 50_000n - amount - 400n })
      .build();
  };

  it('credits the paying address with the amount sent to the merchant', () => {
    const payment = readPayment(pay(customer, merchant.address, 12_345n), 'tx', merchant.pkh, 'bchtest');
    expect(payment).toEqual({ txid: 'tx', paidSats: 12_345n, payerTokenAddress: customer.tokenAddress });
    expect(stampsEarned(payment!.paidSats, 1000n)).toBe(12n);
  });

  it("ignores the merchant's own transactions", () => {
    expect(readPayment(pay(merchant, merchant.address, 5000n), 'tx', merchant.pkh, 'bchtest')).toBeUndefined();
  });

  it('ignores transactions that pay someone else', () => {
    expect(readPayment(pay(customer, wallet().address, 5000n), 'tx', merchant.pkh, 'bchtest')).toBeUndefined();
  });
});
