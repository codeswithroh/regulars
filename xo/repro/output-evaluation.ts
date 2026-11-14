// Repro: an output lockingScript written as a CashASM evaluation resolves differently in the XO
// engine than in libauth. Nothing is broadcast. Run: npx -w xo tsx repro/output-evaluation.ts
// (needs XO_MNEMONIC in ../.env only to open an engine account; any test mnemonic works)
import 'fake-indexeddb/auto';
import { walletTemplateToCompilerBch, binToHex, hexToBin } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import type { XOTemplate } from '@xo-cash/types';
import { env } from '@regulars/cli/src/config.ts';

const PKH = 'bdb1e01a0934bc3d285faa7612d72f374bd17fda';
const SCRIPTS = {
  literalsOnly: '<0x76a914> <0x88ac> OP_CAT',
  withVariable: '<0x76a914> <merchantPkh> OP_CAT <0x88ac> OP_CAT',
  variableOnly: '<merchantPkh>',
};

// Minimal XO template: one action whose only output's locking script is `$(probe)`.
const template = (probe: string): XOTemplate => ({
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: `evaluation repro: ${probe}`,
  description: 'Output locking script written as a CashASM evaluation.',
  version: '1',
  supported: ['BCH_2026_05'],
  roles: { payer: { name: 'Payer', description: 'Pays.' } },
  start: [{ action: 'pay', role: 'payer' }],
  actions: {
    pay: {
      name: 'Pay', description: 'Pay a P2PKH built by concatenation.',
      roles: { payer: { requirements: { variables: ['merchantPkh'] } } },
      requirements: { participants: [{ role: 'payer', slots: { min: 1, max: 1 } }] },
      transaction: 'payTransaction',
    },
  },
  transactions: { payTransaction: { name: 'Paid', description: 'Paid.', inputs: [], outputs: [{ output: 'payOutput', outputIndex: 0 }] } },
  inputs: {},
  constants: {},
  icons: [],
  outputs: { payOutput: { name: 'Payment', description: 'Payment.', lockingScript: '$(probe)', valueSatoshis: 1000n, token: null } },
  lockingScripts: {},
  scripts: { probe },
  variables: { merchantPkh: { name: 'Merchant key hash', description: 'hash160', type: 'bytes' } },
} as never);

const libauth = (probe: string) => {
  const compiler = walletTemplateToCompilerBch({
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
    entities: { e: { name: 'e', variables: { merchantPkh: { type: 'AddressData' } } } },
    scripts: { probe: { script: probe }, lock: { lockingType: 'standard', script: '$(probe)' } },
    supported: ['BCH_2025_05'], version: 0,
  } as never);
  const r = compiler.generateBytecode({ scriptId: 'lock', data: { bytecode: { merchantPkh: hexToBin(PKH) } } });
  return r.success ? binToHex(r.bytecode) : 'compile failed';
};

const engine = await Engine.create(env('XO_MNEMONIC'), { network: XO_SUPPORTED_NETWORKS.chipnet });
try {
  for (const [name, probe] of Object.entries(SCRIPTS)) {
    const { templateIdentifier } = await engine.importTemplate(template(probe));
    const tpl = (await engine.getTemplate(templateIdentifier))!;
    const inv = await engine.createInvitation({
      templateIdentifier, actionIdentifier: 'pay', intent: tpl.start![0],
      variables: [{ variableIdentifier: 'merchantPkh', roleIdentifier: 'payer', value: PKH as never }],
    });
    const xo = await engine.resolveInvitationOutputLockingBytecode(inv.invitation.invitationIdentifier, 'payOutput');
    console.log(`${name}\n  script:  ${probe}\n  libauth: ${libauth(probe)}\n  engine:  ${xo}`);
    await engine.archiveInvitation(inv.invitation.invitationIdentifier);
  }
} finally {
  await engine.stop();
}
process.exit(0);
