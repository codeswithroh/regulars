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
    merchant: { name: 'Shop', description: 'Opens a shop, is paid by its customers, and can close it.', icon: 'shop' },
  },

  // Earning is available to anyone with a shop's parameters. The key generated here locks the
  // stamps the customer receives, and is what the redeem follow-up signs with.
  start: [
    { action: 'earn', role: 'customer', generate: ['ownerKey'] },
    // Opening generates the shop key: payments go to it, and only it can close the shop's contracts.
    { action: 'openShop', role: 'merchant', generate: ['merchantKey'] },
  ],

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
    redeemFresh: {
      name: 'Redeem stamps (first redemption)',
      description: "Hand stamps to a reward reserve nobody has redeemed against yet, and take the BCH they are worth.",
      icon: 'redeem',
      roles: {
        customer: { requirements: { variables: [...shopVariables, 'reserveSatoshis', 'stamps'] } },
      },
      requirements: { participants: [{ role: 'customer', slots: { min: 1, max: 1 } }] },
      transaction: 'redeemFreshTransaction',
    },
    openShop: {
      name: 'Open a shop',
      description: 'Mint the stamp supply into an issuer contract and lock a reward reserve, in one transaction.',
      icon: 'shop',
      roles: {
        merchant: { requirements: { variables: ['stampCategory', 'satsPerStampEarned', 'satsPerStampRedeemed', ...protocolVariables, 'supply', 'reserveFunding', 'shopName'] } },
      },
      requirements: { participants: [{ role: 'merchant', slots: { min: 1, max: 1 } }] },
      transaction: 'openShopTransaction',
    },
    closeIssuer: {
      name: 'Retire an issuer output',
      description: 'Take back the stamps an issuer output has not given out. Accrued protocol fees, if any, go to the protocol.',
      icon: 'shop',
      roles: { merchant: { requirements: { secrets: ['merchantKey'], variables: ['refundSatoshis'] } } },
      requirements: { participants: [{ role: 'merchant', slots: { min: 1, max: 1 } }] },
      transaction: 'closeIssuerTransaction',
    },
    withdrawReserve: {
      name: 'Withdraw the reward reserve',
      description: "Take the reward reserve's BCH and handed-in stamps back to the shop.",
      icon: 'shop',
      roles: { merchant: { requirements: { secrets: ['merchantKey'], variables: ['refundSatoshis'] } } },
      requirements: { participants: [{ role: 'merchant', slots: { min: 1, max: 1 } }] },
      transaction: 'withdrawReserveTransaction',
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
    redeemFreshTransaction: {
      name: 'Redeemed stamps',
      description: 'Redeemed $(<stamps>) stamps for BCH.',
      icon: 'redeem',
      inputs: [{ input: 'freshReserveInput', inputIndex: 0 }],
      outputs: [{ output: 'freshReserveOutput', outputIndex: 0 }],
    },
    openShopTransaction: {
      name: 'Opened a shop',
      description: 'Minted $(<supply>) stamps into an issuer contract and locked $(<reserveFunding>) satoshis as the reward reserve.',
      icon: 'shop',
      // The stamps' category is the txid of the coin spent at input 0, which must be an output 0.
      inputs: [],
      outputs: [
        { output: 'shopIssuerOutput', outputIndex: 0 },
        { output: 'shopReserveOutput', outputIndex: 1 },
        { output: 'announceOutput', outputIndex: 2 },
      ],
    },
    closeIssuerTransaction: {
      name: 'Retired an issuer output',
      description: 'The shop took back its unissued stamps.',
      icon: 'shop',
      inputs: [{ input: 'closeIssuerInput', inputIndex: 0 }],
      // The stamps are not carried over: retiring an issuer output burns them.
      outputs: [{ output: 'protocolFeeOutput', outputIndex: 0 }, { output: 'shopRefundOutput', outputIndex: undefined }],
    },
    withdrawReserveTransaction: {
      name: 'Withdrew the reward reserve',
      description: 'The shop took its reward reserve back.',
      icon: 'shop',
      inputs: [{ input: 'withdrawReserveInput', inputIndex: undefined }],
      outputs: [{ output: 'shopRefundOutput', outputIndex: undefined }],
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
    freshReserveInput: {
      name: 'Reward reserve',
      description: "A shop's reward reserve that holds no stamps yet.",
      icon: 'contract',
      valueSatoshis: '$(<reserveSatoshis>)',
      token: null,
      unlockingScript: 'reserveRedeemUnlockingBytecode',
    },
    closeIssuerInput: {
      name: 'Stamp issuer',
      description: "One of the shop's issuer outputs, retired by the shop key.",
      icon: 'contract',
      unlockingScript: 'issuerWithdrawUnlock',
    },
    withdrawReserveInput: {
      name: 'Reward reserve',
      description: "The shop's reward reserve, withdrawn by the shop key.",
      icon: 'contract',
      unlockingScript: 'reserveWithdrawUnlock',
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
    freshReserveOutput: {
      name: 'Reward reserve',
      description: 'The reserve, recreated holding its first handed-in stamps and less BCH.',
      icon: 'contract',
      lockingScript: 'reserveLockingScript',
      valueSatoshis: '$(<reserveSatoshis> <stamps> <satsPerStampRedeemed> OP_MUL OP_SUB)',
      token: { category: '$(<stampCategory>)', amount: '$(<stamps>)', nft: null },
      selectable: false,
      balance: assetsNotOurs,
    },
    shopIssuerOutput: {
      name: 'Stamp issuer',
      description: 'The issuer contract holding the whole stamp supply.',
      icon: 'contract',
      lockingScript: 'shopIssuerLockingScript',
      valueSatoshis: '$(<tokenDust>)',
      token: { category: '$(<stampCategory>)', amount: '$(<supply>)', nft: null },
      selectable: false,
      balance: assetsNotOurs,
    },
    shopReserveOutput: {
      name: 'Reward reserve',
      description: 'BCH locked to pay for redeemed stamps.',
      icon: 'contract',
      lockingScript: 'shopReserveLockingScript',
      valueSatoshis: '$(<reserveFunding>)',
      token: null,
      selectable: false,
      balance: assetsNotOurs,
    },
    announceOutput: {
      name: 'Shop announcement',
      description: 'Names the shop and its key hash on chain, so anyone can rebuild its link.',
      icon: 'shop',
      lockingScript: 'announceLockingScript',
      valueSatoshis: '0',
      token: null,
      balance: assetsNotOurs,
    },
    shopRefundOutput: {
      name: 'Back to the shop',
      description: 'BCH returned to the shop key when it closes a contract output.',
      icon: 'shop',
      lockingScript: 'shopKeyLockingScript',
      valueSatoshis: '$(<refundSatoshis>)',
      token: null,
    },
    protocolFeeOutput: {
      name: 'Protocol fees',
      description: 'Fees the issuer output accrued, forwarded to the protocol.',
      icon: 'contract',
      lockingScript: 'protocolLockingScript',
      valueSatoshis: '$(<forwardSatoshis>)',
      token: null,
      balance: assetsNotOurs,
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
    shopIssuerLockingScript: {
      name: 'Stamp issuer contract (shop)',
      description: "The shop's view of its issuer contract: the same script, built from the shop key, so the shop can retire it.",
      icon: 'contract',
      lockingType: 'p2sh',
      lockingBytecode: 'shopIssuerRedeemBytecode',
      state: { variables: ['stampCategory', 'satsPerStampEarned', ...protocolVariables], secrets: [] },
      actions: [],
      roles: {
        merchant: {
          state: { variables: [], secrets: ['merchantKey'] },
          actions: [{ action: 'closeIssuer', role: 'merchant', secrets: [{ merchantKey: null }] }],
          balance: { satoshis: 0n, fungibleTokens: 0n, nonfungibleTokens: 0 },
          selectable: false,
        },
      },
    },
    shopReserveLockingScript: {
      name: 'Reward reserve contract (shop)',
      description: "The shop's view of its reward reserve, built from the shop key, so the shop can withdraw it.",
      icon: 'contract',
      lockingType: 'p2sh',
      lockingBytecode: 'shopReserveRedeemBytecode',
      state: { variables: ['stampCategory', 'satsPerStampRedeemed'], secrets: [] },
      actions: [],
      roles: {
        merchant: {
          state: { variables: [], secrets: ['merchantKey'] },
          actions: [{ action: 'withdrawReserve', role: 'merchant', secrets: [{ merchantKey: null }] }],
          balance: { satoshis: 0n, fungibleTokens: 0n, nonfungibleTokens: 0 },
          selectable: false,
        },
      },
    },
    shopKeyLockingScript: {
      name: 'Shop payments',
      description: "Payments to the shop, locked to the shop key.",
      icon: 'shop',
      lockingType: 'p2pkh',
      lockingBytecode: 'lockShopKey',
      unlockingBytecode: 'unlockShopKey',
      actions: [],
      roles: {
        merchant: {
          state: { variables: [], secrets: ['merchantKey'] },
          actions: [],
          balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: 0 },
          selectable: true,
        },
      },
    },
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
    announceLockingScript: {
      name: 'Shop announcement',
      description: 'An OP_RETURN naming the shop.',
      icon: 'shop',
      lockingType: 'p2s',
      lockingBytecode: 'announceBytecode',
      state: { variables: [], secrets: [] },
      selectable: false,
      balance: assetsNotOurs,
      roles: { merchant: { relevant: false } },
    },
    protocolLockingScript: {
      name: 'Protocol',
      description: 'The protocol treasury address.',
      icon: 'contract',
      lockingType: 'p2s',
      lockingBytecode: 'protocolP2PKH',
      state: { variables: [], secrets: [] },
      selectable: false,
      balance: assetsNotOurs,
      roles: { merchant: { relevant: false } },
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
          // `redeemFresh` is for a reserve nobody has redeemed against yet (it holds no stamps).
          actions: [
            { action: 'redeem', role: 'customer', secrets: [{ ownerKey: null }] },
            { action: 'redeemFresh', role: 'customer', secrets: [{ ownerKey: null }] },
          ],
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
    protocolP2PKH: 'OP_DUP OP_HASH160 <protocolPkh> OP_EQUALVERIFY OP_CHECKSIG',

    // The shop's own view of the same two contracts: identical bytes, with the key hash computed from
    // the shop key, so the engine can track and sign for them.
    shopIssuerRedeemBytecode: `<protocolPkh> <feePerStamp> <$(<merchantKey.public_key> OP_HASH160)> <satsPerStampEarned> <$(<stampCategory> OP_REVERSEBYTES)> ${toCashAsm(issuerArtifact.bytecode)}`,
    shopReserveRedeemBytecode: `<$(<merchantKey.public_key> OP_HASH160)> <satsPerStampRedeemed> <$(<stampCategory> OP_REVERSEBYTES)> ${toCashAsm(reserveArtifact.bytecode)}`,
    // withdraw(merchantPk, merchantSig): arguments are pushed last-first, then the function selector
    // (issuer: earn 0, collect 1, withdraw 2; reserve: redeem 0, withdraw 1). P2SH appends the redeem script.
    issuerWithdrawUnlock: '<merchantKey.schnorr_signature.all_outputs> <merchantKey.public_key> OP_2',
    reserveWithdrawUnlock: '<merchantKey.schnorr_signature.all_outputs> <merchantKey.public_key> OP_1',
    lockShopKey: 'OP_DUP OP_HASH160 <$(<merchantKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
    unlockShopKey: '<merchantKey.schnorr_signature.all_outputs> <merchantKey.public_key>',
    // OP_RETURN "RGLR" <shop key hash> <name>: enough for anyone to rebuild the shop link with the stamp category (this txid).
    announceBytecode: 'OP_RETURN <"RGLR"> <$(<merchantKey.public_key> OP_HASH160)> <shopName>',
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
    merchantKey: v('Shop key', 'Key the shop is paid to; the only key that can close its contracts.', 'private_key'),
    supply: v('Stamp supply', 'Stamps minted into the issuer contract when the shop opens.', 'token_amount'),
    reserveFunding: v('Reserve funding', 'Satoshis locked in the reward reserve when the shop opens.', 'satoshis'),
    shopName: v('Shop name', 'Name shown to customers (UTF-8 bytes).', 'bytes'),
    refundSatoshis: v('Refund', 'Satoshis returned to the shop key after the network fee.', 'satoshis'),
    forwardSatoshis: v('Forwarded fees', 'Accrued protocol fees forwarded when an issuer output is retired.', 'satoshis'),
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
