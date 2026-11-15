// A NetworkProvider that spreads risk over several Electrum servers. If a server times out or the
// connection drops, the call is retried on the next one. Rejections from the BCH network itself
// (an invalid or conflicting transaction) are not connection problems and are passed straight up.
import { ElectrumNetworkProvider, Network, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { hashTransaction, hexToBin } from '@bitauth/libauth';

export const ELECTRUM_HOSTS: Record<string, string[]> = {
  [Network.MAINNET]: ['bch.imaginary.cash', 'electrum.imaginary.cash', 'cashnode.bch.ninja', 'fulcrum.greyh.at'],
  // chipnet.imaginary.cash is left out: it answers but returns no token-carrying outputs, which
  // makes every shop look empty. Each server here was checked against the live contracts.
  [Network.CHIPNET]: ['chipnet.bch.ninja'],
};

/** Errors that mean "the network said no", which no other server would answer differently. */
const FINAL = /reject|conflict|missing ?inputs|mandatory|non-?standard|dust|insufficient|bad-txns|already spent|txn-mempool|min relay fee|invalid/i;
const ALREADY_KNOWN = /already (in|known)|txn-already-known|transaction already in block chain/i;

const withTimeout = <T>(work: Promise<T>, ms: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    work.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

export class FailoverProvider implements NetworkProvider {
  private index = 0;
  private current: ElectrumNetworkProvider;
  private connecting?: Promise<void>;
  /** Called whenever the provider moves to another server (for logging or UI). */
  onSwitch?: (host: string, reason: string) => void;

  constructor(public network: Network, private hosts: string[] = ELECTRUM_HOSTS[network] ?? [], private timeoutMs = 12_000) {
    if (this.hosts.length === 0) throw new Error(`No Electrum servers configured for ${network}`);
    this.current = this.make(this.hosts[0]);
  }

  get host() { return this.hosts[this.index]; }

  private make(host: string) {
    return new ElectrumNetworkProvider(this.network, { hostname: host, manualConnectionManagement: true });
  }

  /** Connect to the current server, moving down the list until one answers. */
  ready(): Promise<void> {
    this.connecting ??= (async () => {
      for (let tried = 0; tried < this.hosts.length; tried++) {
        try {
          await withTimeout(this.current.connect(), this.timeoutMs, `Connecting to ${this.host}`);
          return;
        } catch (error) {
          this.advance(error);
        }
      }
      throw new Error('Could not reach any Bitcoin Cash server. Check your connection and try again.');
    })().catch((error) => { this.connecting = undefined; throw error; });
    return this.connecting;
  }

  private advance(error: unknown) {
    const old = this.current;
    old.disconnect().catch(() => false);
    this.index = (this.index + 1) % this.hosts.length;
    this.current = this.make(this.host);
    this.connecting = undefined;
    this.onSwitch?.(this.host, error instanceof Error ? error.message : String(error));
  }

  /** Run `work` on the current server; on a connection-type failure, retry on the next. */
  private async call<T>(label: string, work: (p: ElectrumNetworkProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let tried = 0; tried < this.hosts.length; tried++) {
      try {
        await this.ready();
        return await withTimeout(work(this.current), this.timeoutMs, label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (FINAL.test(message) || ALREADY_KNOWN.test(message)) throw error;
        lastError = error;
        this.advance(error);
      }
    }
    throw lastError;
  }

  getUtxos(address: string): Promise<SpendableUtxo[]> { return this.call('getUtxos', (p) => p.getUtxos(address)); }
  getUtxosForLockingBytecode(lockingBytecode: Uint8Array | string): Promise<SpendableUtxo[]> {
    return this.call('getUtxos', (p) => p.getUtxosForLockingBytecode(lockingBytecode));
  }
  getBlockHeight(): Promise<number> { return this.call('getBlockHeight', (p) => p.getBlockHeight()); }
  getRawTransaction(txid: string): Promise<string> { return this.call('getRawTransaction', (p) => p.getRawTransaction(txid)); }
  performRequest(name: string, ...parameters: (string | number | boolean)[]) {
    return this.call(name, (p) => p.performRequest(name, ...parameters));
  }

  /**
   * Broadcasting the same transaction twice is harmless, so a failed attempt is retried on the next
   * server. If an earlier attempt did reach the network, the retry reports it as already known,
   * which is a success.
   */
  async sendRawTransaction(txHex: string): Promise<string> {
    try {
      return await this.call('Broadcast', (p) => p.sendRawTransaction(txHex));
    } catch (error) {
      if (ALREADY_KNOWN.test(error instanceof Error ? error.message : String(error))) return hashTransaction(hexToBin(txHex));
      throw error;
    }
  }

  async disconnect() {
    this.connecting = undefined;
    return this.current.disconnect().catch(() => false);
  }
}
