// The Regulars XO template, generated from the compiled CashScript artifacts so its scripts are
// byte-for-byte the covenants the web app uses. `npm run template -w xo` writes regulars.template.json.
import type { XOTemplate } from '@xo-cash/types';
import { issuerArtifact, reserveArtifact } from '@regulars/contracts';

/** CashScript artifact ASM → CashASM: opcodes stay as they are, data pushes become <0x…>. */
const toCashAsm = (asm: string) => asm.trim().split(/\s+/).map((t) => (t.startsWith('OP_') ? t : `<0x${t}>`)).join(' ');

const assetsNotOurs = { satoshis: 0n, fungibleTokens: 0n, nonfungibleTokens: 0 } as const;
const v = (name: string, description: string, type: string) => ({ name, description, type: type as never });

// Shop parameters, exactly the five values in a Regulars shop link.
const shopVariables = ['stampCategory', 'merchantPkh', 'satsPerStampEarned', 'satsPerStampRedeemed'];
const protocolVariables = ['feePerStamp', 'protocolPkh'];

export const regularsTemplate: XOTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: 'Regulars',
  description: 'Loyalty stamps on Bitcoin Cash: pay a shop and receive its stamps in the same transaction, then redeem them for BCH from a reserve the shop locked up front.',
  icon: 'regulars',
  version: '1',
  supported: ['BCH_2025_05', 'BCH_2026_05'],
  resources: [
    { name: 'Regulars', description: 'Live app and source code.', url: 'https://github.com/codeswithroh/regulars' },
  ],

  roles: {
    customer: { name: 'Customer', description: 'Pays the shop and holds its stamps.', icon: 'customer' },
  },

  // Earning is available to anyone with a shop's parameters. The key generated here locks the
  // stamps the customer receives, and is what the redeem follow-up signs with.
  start: [{ action: 'earn', role: 'customer', generate: ['ownerKey'] }],

  actions: {
    earn: {
      name: 'Pay and earn stamps',
      description: 'Pay a shop and take the stamps that payment earns from its issuer contract, in one transaction.',
      icon: 'stamp',
      roles: {
        customer: { requirements: { variables: [...shopVariables, ...protocolVariables, 'issuerSatoshis', 'issuerStamps', 'stamps'] } },
      },
      requirements: { participants: [{ role: 'customer', slots: { min: 1, max: 1 } }] },
      transaction: 'earnTransaction',
    },
    redeem: {
      name: 'Redeem stamps',
      description: "Hand stamps to the shop's reward reserve and take the BCH they are worth.",
      icon: 'redeem',
      roles: {
        customer: { requirements: { variables: [...shopVariables, 'reserveSatoshis', 'reserveStamps', 'stamps'] } },
      },
      requirements: { participants: [{ role: 'customer', slots: { min: 1, max: 1 } }] },
      transaction: 'redeemTransaction',
    },
  },

  transactions: {
    earnTransaction: {
      name: 'Earned stamps',
      description: 'Paid a shop and earned $(<stamps>) stamps.',
      icon: 'stamp',
      inputs: [{ input: 'issuerInput', inputIndex: 0 }],
      outputs: [
        { output: 'issuerOutput', outputIndex: 0 },
        { output: 'shopPaymentOutput', outputIndex: 1 },
        { output: 'stampsOutput', outputIndex: undefined },
      ],
    },
    redeemTransaction: {
      name: 'Redeemed stamps',
      description: 'Redeemed $(<stamps>) stamps for BCH.',
      icon: 'redeem',
      inputs: [{ input: 'reserveInput', inputIndex: 0 }],
      outputs: [{ output: 'reserveOutput', outputIndex: 0 }],
    },
  },

  inputs: {
    issuerInput: {
      name: 'Stamp issuer',
      description: "The shop's issuer contract output being drawn from.",
      icon: 'contract',
      valueSatoshis: '$(<issuerSatoshis>)',
      token: { category: '$(<stampCategory>)', amount: '$(<issuerStamps>)', nft: null },
      unlockingScript: 'issuerEarnUnlockingBytecode',
    },
    reserveInput: {
      name: 'Reward reserve',
      description: "The shop's reward reserve being redeemed against.",
      icon: 'contract',
      valueSatoshis: '$(<reserveSatoshis>)',
      token: { category: '$(<stampCategory>)', amount: '$(<reserveStamps>)', nft: null },
      unlockingScript: 'reserveRedeemUnlockingBytecode',
    },
  },

  outputs: {
    issuerOutput: {
      name: 'Stamp issuer',
      description: 'The issuer contract, recreated with fewer stamps and the protocol fee added.',
      icon: 'contract',
      lockingScript: 'issuerLockingScript',
      valueSatoshis: '$(<issuerSatoshis> <stamps> <feePerStamp> OP_MUL OP_ADD)',
      token: { category: '$(<stampCategory>)', amount: '$(<issuerStamps> <stamps> OP_SUB)', nft: null },
      selectable: false,
      balance: assetsNotOurs,
    },
    shopPaymentOutput: {
      name: 'Payment to shop',
      description: 'What the shop receives for the stamps earned.',
      icon: 'shop',
      lockingScript: 'shopLockingScript',
      valueSatoshis: '$(<stamps> <satsPerStampEarned> <feePerStamp> OP_SUB OP_MUL)',
      token: null,
      balance: assetsNotOurs,
    },
    stampsOutput: {
      name: 'Stamps',
      description: '$(<stamps>) loyalty stamps, redeemable at the shop reserve.',
      icon: 'stamp',
      lockingScript: 'stampsLockingScript',
      valueSatoshis: '$(<tokenDust>)',
      token: { category: '$(<stampCategory>)', amount: '$(<stamps>)', nft: null },
    },
    reserveOutput: {
      name: 'Reward reserve',
      description: 'The reserve, recreated holding the handed-in stamps and less BCH.',
      icon: 'contract',
      lockingScript: 'reserveLockingScript',
      valueSatoshis: '$(<reserveSatoshis> <stamps> <satsPerStampRedeemed> OP_MUL OP_SUB)',
      token: { category: '$(<stampCategory>)', amount: '$(<reserveStamps> <stamps> OP_ADD)', nft: null },
      selectable: false,
      balance: assetsNotOurs,
    },
  },

  lockingScripts: {
    issuerLockingScript: {
      name: 'Stamp issuer contract',
      description: "Releases a shop's stamps only in a transaction that pays the shop for them.",
      icon: 'contract',
      lockingType: 'p2sh',
      lockingBytecode: 'issuerRedeemBytecode',
      state: { variables: [], secrets: [] },
      selectable: false,
      balance: assetsNotOurs,
      roles: { customer: { relevant: false } },
    },
    reserveLockingScript: {
      name: 'Reward reserve contract',
      description: 'Pays a fixed amount of BCH for every stamp handed in.',
      icon: 'contract',
      lockingType: 'p2sh',
      lockingBytecode: 'reserveRedeemBytecode',
      state: { variables: [], secrets: [] },
      selectable: false,
      balance: assetsNotOurs,
      roles: { customer: { relevant: false } },
    },
    shopLockingScript: {
      name: 'Shop',
      description: "The shop's own address, where payments go.",
      icon: 'shop',
      lockingType: 'p2s',
      lockingBytecode: 'shopP2PKH',
      state: { variables: [], secrets: [] },
      selectable: false,
      balance: assetsNotOurs,
      roles: { customer: { relevant: false } },
    },
    stampsLockingScript: {
      name: 'Stamps',
      description: "Loyalty stamps held by the customer's own key.",
      icon: 'stamp',
      lockingType: 'p2pkh',
      lockingBytecode: 'lockStamps',
      unlockingBytecode: 'unlockStamps',
      actions: [],
      roles: {
        customer: {
          state: { variables: [], secrets: ['ownerKey'] },
          // Follow-up: stamps received from `earn` can be redeemed.
          actions: [{ action: 'redeem', role: 'customer', secrets: [{ ownerKey: null }] }],
          balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: 0 },
          // Stamps are spent through `redeem`, not picked up by ordinary coin selection.
          selectable: false,
        },
      },
    },
  },

  scripts: {
    // StampIssuer(stampCategory, satsPerStampEarned, merchantPkh, feePerStamp, protocolPkh).
    // CashScript pushes constructor arguments last-first, and introspection sees a token
    // category in the opposite byte order from wallets, hence OP_REVERSEBYTES.
    issuerRedeemBytecode: `<protocolPkh> <feePerStamp> <merchantPkh> <satsPerStampEarned> <$(<stampCategory> OP_REVERSEBYTES)> ${toCashAsm(issuerArtifact.bytecode)}`,
    // Function selector 0 is earn().
    issuerEarnUnlockingBytecode: 'OP_0 <issuerRedeemBytecode>',

    // RewardReserve(stampCategory, satsPerStamp, merchantPkh).
    reserveRedeemBytecode: `<merchantPkh> <satsPerStampRedeemed> <$(<stampCategory> OP_REVERSEBYTES)> ${toCashAsm(reserveArtifact.bytecode)}`,
    // Function selector 0 is redeem().
    reserveRedeemUnlockingBytecode: 'OP_0 <reserveRedeemBytecode>',

    shopP2PKH: 'OP_DUP OP_HASH160 <merchantPkh> OP_EQUALVERIFY OP_CHECKSIG',
    lockStamps: 'OP_DUP OP_HASH160 <$(<ownerKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
    unlockStamps: '<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key>',
  },

  constants: {
    tokenDust: { name: 'Token output value', description: 'Satoshis carried by an output holding tokens.', type: 'satoshis', value: 1000n },
  },

  variables: {
    ownerKey: v('Stamp key', 'Key that holds the stamps the customer earns.', 'private_key'),
    stampCategory: v('Stamp token', "Token category of the shop's stamps, as wallets show it.", 'token_category'),
    merchantPkh: v('Shop key hash', 'hash160 of the key the shop is paid to.', 'bytes'),
    satsPerStampEarned: v('Sats per stamp', 'The customer earns one stamp per this many satoshis paid.', 'integer'),
    satsPerStampRedeemed: v('Reward per stamp', 'Satoshis the reserve pays for each stamp.', 'integer'),
    feePerStamp: v('Protocol fee per stamp', 'Satoshis per stamp issued that stay in the issuer for the protocol.', 'integer'),
    protocolPkh: v('Protocol key hash', 'hash160 of the protocol treasury key.', 'bytes'),
    issuerSatoshis: v('Issuer satoshis', 'Satoshis on the issuer output being spent.', 'satoshis'),
    issuerStamps: v('Issuer stamps', 'Stamps on the issuer output being spent.', 'token_amount'),
    reserveSatoshis: v('Reserve satoshis', 'Satoshis on the reserve output being spent.', 'satoshis'),
    reserveStamps: v('Reserve stamps', 'Stamps already handed in to the reserve output being spent.', 'token_amount'),
    stamps: v('Stamps', 'Number of stamps to earn or redeem.', 'token_amount'),
  },

  icons: [
    { name: 'regulars', hash: '0000000000000000000000' },
    { name: 'customer', hash: '0000000000000000000000' },
    { name: 'stamp', hash: '0000000000000000000000' },
    { name: 'redeem', hash: '0000000000000000000000' },
    { name: 'contract', hash: '0000000000000000000000' },
    { name: 'shop', hash: '0000000000000000000000' },
  ],
};
