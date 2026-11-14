// A headless HD wallet that speaks WizardConnect, standing in for Selene/Paytaca in tests.
// It approves every signing request, signing exactly the inputs the dapp names in inputPaths.
import { randomBytes } from 'node:crypto';
import { SighashType, SignatureTemplate } from 'cashscript';
import {
  deriveHdPath, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, deriveHdPrivateNodeChild, encodeHdPublicKey,
  secp256k1, hash160, encodeCashAddress, decodeTransaction, encodeTransaction, hexToBin, binToHex,
  type Transaction,
} from '@bitauth/libauth';
import { parseExtendedJson } from '@wizardconnect/core';
import { WalletConnectionManager, DerivationPath, type WalletAdapter } from '@wizardconnect/wallet';

const PATH_INDEX: Record<string, DerivationPath> = { receive: DerivationPath.Receive, change: DerivationPath.Change, defi: DerivationPath.Cauldron };

export class TestWallet implements WalletAdapter {
  walletName = 'Test Wallet';
  walletIcon = '';
  signed: string[] = [];
  /** When set, the next signing request is refused, as if the user tapped Reject. */
  rejectNext = false;
  private account;
  private relayKey = randomBytes(32);
  private manager = new WalletConnectionManager(this);

  constructor(private prefix: 'bchtest' | 'bitcoincash', seed: Uint8Array = randomBytes(32)) {
    const root = deriveHdPrivateNodeFromSeed(seed, { throwErrors: true });
    this.account = deriveHdPath(root, "m/44'/145'/0'");
    this.manager.on('pendingSignRequest', async ({ connectionId, request }) => {
      try {
        if (this.rejectNext) {
          this.rejectNext = false;
          throw new Error('User rejected the request');
        }
        const { signedTransaction } = await this.signTransaction(request);
        await this.manager.sendSignResponse(connectionId, request.sequence, signedTransaction);
      } catch (error) {
        await this.manager.sendSignError(connectionId, request.sequence, error instanceof Error ? error.message : String(error));
      }
    });
  }

  private pathNode = (path: DerivationPath) => deriveHdPrivateNodeChild(this.account, path);
  private privateKey = (path: DerivationPath, index: bigint) => deriveHdPrivateNodeChild(this.pathNode(path), Number(index)).privateKey;

  getRelayPrivateKey = () => this.relayKey;
  getPublicKey = (path: DerivationPath, index: bigint) => secp256k1.derivePublicKeyCompressed(this.privateKey(path, index)) as Uint8Array;
  getXpub = (path: DerivationPath) =>
    encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(this.pathNode(path)) }, { throwErrors: true }).hdPublicKey;

  address(path: DerivationPath, index: number, tokens = false) {
    const payload = hash160(this.getPublicKey(path, BigInt(index)));
    return encodeCashAddress({ prefix: this.prefix, type: tokens ? 'p2pkhWithTokens' : 'p2pkh', payload, throwErrors: true }).address;
  }

  async signTransaction(request: Parameters<WalletAdapter['signTransaction']>[0]) {
    const { inputPaths } = request;
    // Revive bigints and byte arrays from the relay's extended-JSON encoding.
    const wc = parseExtendedJson(JSON.stringify(request.transaction)) as typeof request.transaction;
    let tx: Transaction;
    if (typeof wc.transaction === 'string') {
      const decoded = decodeTransaction(hexToBin(wc.transaction));
      if (typeof decoded === 'string') throw new Error(decoded);
      tx = decoded;
    } else {
      tx = wc.transaction;
    }
    for (const [inputIndex, pathName, addressIndex] of inputPaths) {
      const path = PATH_INDEX[pathName];
      if (path === undefined) throw new Error(`Unknown path ${pathName}`);
      // WizardConnect requires SIGHASH_ALL | SIGHASH_FORKID | SIGHASH_UTXOS.
      const signer = new SignatureTemplate(this.privateKey(path, BigInt(addressIndex)), SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS);
      tx.inputs[inputIndex].unlockingBytecode = signer.unlockP2PKH().generateUnlockingBytecode({
        transaction: tx, sourceOutputs: wc.sourceOutputs as never, inputIndex,
      });
    }
    const signedTransaction = binToHex(encodeTransaction(tx));
    this.signed.push(signedTransaction);
    return { signedTransaction };
  }

  connect = (uri: string) => this.manager.connect(uri);
  close = () => this.manager.disconnectAll();
}
