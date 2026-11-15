// Network test: talks to real chipnet Electrum servers.
import { Network } from 'cashscript';
import { FailoverProvider } from '../src/index.js';

const TXID = '3f72c8060ce6a7505994c8c3289c178c4efb2536cf837f176c94f804be1bbe84'; // an XO earn on chipnet

describe('FailoverProvider', () => {
  it('skips an unreachable server and answers from the next one', async () => {
    const switches: string[] = [];
    const provider = new FailoverProvider(Network.CHIPNET, ['unreachable.invalid', 'chipnet.bch.ninja'], 5000);
    provider.onSwitch = (host) => switches.push(host);
    expect(await provider.getBlockHeight()).toBeGreaterThan(200_000);
    expect(switches).toEqual(['chipnet.bch.ninja']);
    expect((await provider.getRawTransaction(TXID)).length).toBeGreaterThan(100);
    await provider.disconnect();
  }, 30_000);

  it('passes network rejections straight through without switching servers', async () => {
    const switches: string[] = [];
    const provider = new FailoverProvider(Network.CHIPNET, ['chipnet.bch.ninja', 'chipnet.bch.ninja']);
    provider.onSwitch = (host) => switches.push(host);
    // A real, already-mined transaction: rebroadcasting it must not be retried elsewhere.
    const raw = await provider.getRawTransaction(TXID);
    await provider.sendRawTransaction(raw).then(
      (txid) => expect(txid).toBe(TXID),
      (error) => expect(String(error)).toMatch(/already|known|missing|spent|conflict/i),
    );
    expect(switches).toEqual([]);
    await provider.disconnect();
  }, 30_000);

  it('gives a clear error when no server can be reached', async () => {
    const provider = new FailoverProvider(Network.CHIPNET, ['a.invalid', 'b.invalid'], 3000);
    await expect(provider.getBlockHeight()).rejects.toThrow(/any Bitcoin Cash server|timed out|invalid/i);
  }, 30_000);
});
