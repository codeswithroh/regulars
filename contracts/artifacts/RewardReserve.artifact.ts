export default {
  contractName: 'RewardReserve',
  constructorInputs: [
    { name: 'stampCategory', type: 'bytes32' },
    { name: 'satsPerStamp', type: 'int' },
    { name: 'merchantPkh', type: 'bytes20' },
  ],
  abi: [
    { name: 'redeem', inputs: [] },
    {
      name: 'withdraw',
      inputs: [
        { name: 'merchantPk', type: 'pubkey' },
        { name: 'merchantSig', type: 'sig' },
      ],
    },
  ],
  bytecode: 'OP_3 OP_PICK OP_0 OP_NUMEQUAL OP_IF OP_INPUTINDEX OP_DUP OP_OUTPUTBYTECODE OP_OVER OP_UTXOBYTECODE OP_EQUALVERIFY OP_DUP OP_OUTPUTTOKENCATEGORY OP_2 OP_PICK OP_EQUALVERIFY OP_0 OP_OVER OP_UTXOTOKENCATEGORY OP_3 OP_ROLL OP_EQUAL OP_IF OP_OVER OP_UTXOTOKENAMOUNT OP_NIP OP_ELSE OP_OVER OP_UTXOTOKENCATEGORY OP_0 OP_EQUALVERIFY OP_ENDIF OP_OVER OP_OUTPUTTOKENAMOUNT OP_SWAP OP_SUB OP_DUP OP_0 OP_GREATERTHAN OP_VERIFY OP_OVER OP_OUTPUTVALUE OP_ROT OP_UTXOVALUE OP_2SWAP OP_MUL OP_SUB OP_GREATERTHANOREQUAL OP_NIP OP_NIP OP_ELSE OP_3 OP_ROLL OP_1 OP_NUMEQUALVERIFY OP_3 OP_PICK OP_HASH160 OP_3 OP_ROLL OP_EQUALVERIFY OP_2SWAP OP_CHECKSIG OP_NIP OP_NIP OP_ENDIF',
  source: 'pragma cashscript ^0.14.0;\n\n// RewardReserve: a merchant-funded pot of BCH that anyone can draw from by\n// handing in the merchant\'s loyalty "stamp" tokens.\n//\n//   stampCategory  token category of the merchant\'s stamps (unreversed byte order)\n//   satsPerStamp   BCH paid out for every stamp handed in\n//   merchantPkh    the only key that can top up-and-reclaim or close the reserve\ncontract RewardReserve(bytes32 stampCategory, int satsPerStamp, bytes20 merchantPkh) {\n\n    // Anyone: send N stamps into the reserve, take N * satsPerStamp out.\n    // The reserve is recreated at the same output index as its input index, so\n    // several reserve UTXOs in one transaction can never share an output.\n    function redeem() {\n        int i = this.activeInputIndex;\n\n        require(tx.outputs[i].lockingBytecode == tx.inputs[i].lockingBytecode, "reserve must be recreated at the same index");\n        require(tx.outputs[i].tokenCategory == stampCategory, "reserve output must hold this merchant\'s stamps");\n\n        // An input holding some other token must not count toward the stamp balance.\n        int stampsBefore = 0;\n        if (tx.inputs[i].tokenCategory == stampCategory) {\n            stampsBefore = tx.inputs[i].tokenAmount;\n        } else {\n            require(tx.inputs[i].tokenCategory == 0x, "reserve input holds a foreign token");\n        }\n\n        int stampsIn = tx.outputs[i].tokenAmount - stampsBefore;\n        require(stampsIn > 0, "no stamps handed in");\n        require(tx.outputs[i].value >= tx.inputs[i].value - stampsIn * satsPerStamp, "payout exceeds stamps handed in");\n    }\n\n    // Merchant: withdraw BCH and/or collected stamps (to re-issue them).\n    function withdraw(pubkey merchantPk, sig merchantSig) {\n        require(hash160(merchantPk) == merchantPkh, "not the merchant");\n        require(checkSig(merchantSig, merchantPk), "bad merchant signature");\n    }\n}\n',
  fingerprint: '521eeee6e3e4c7fcad2b4e5235b7990368b290d404329ac6af872feb4a114bdf',
  debug: {
    bytecode: '5379009c63c076cd78c78876d15279880078ce537a876378d0776778ce00886878d37c947600a06978cc7bc6729594a2777767537a519d5379a9537a8872ac777768',
    sourceMap: '14:4:31:5;;;;;15:16:15:37;17:27:17:28;:16::45:1;:59::60:0;:49::77:1;:8::126;18:27:18:28:0;:16::43:1;:47::60:0;;:8::113:1;21:27:21:28:0;22:22:22:23;:12::38:1;:42::55:0;;:12:::1;:57:24:9:0;23:37:23:38;:27::51:1;:12::52;24:15:26:9:0;25:30:25:31;:20::46:1;:50::52:0;:12::93:1;24:15:26:9;28:34:28:35:0;:23::48:1;:51::63:0;:23:::1;29:16:29:24:0;:27::28;:16:::1;:8::53;30:27:30:28:0;:16::35:1;:49::50:0;:39::57:1;:60::83:0;::::1;:39;:8::120;14:22:31:5;;:4;34::37::0;;;;35:24:35:34;;:16::35:1;:39::50:0;;:8::72:1;36:25:36:48:0;:8::77:1;34:58:37:5;;9:0:38:1',
    logs: [],
    requires: [
      { ip: 13, line: 17, message: 'reserve must be recreated at the same index' },
      { ip: 18, line: 18, message: 'reserve output must hold this merchant\'s stamps' },
      { ip: 33, line: 25, message: 'reserve input holds a foreign token' },
      { ip: 42, line: 29, message: 'no stamps handed in' },
      { ip: 51, line: 30, message: 'payout exceeds stamps handed in' },
      { ip: 63, line: 35, message: 'not the merchant' },
      { ip: 66, line: 36, message: 'bad merchant signature' },
    ],
    sourceTags: '48:49:sc;63:64:sc',
  },
  compiler: {
    name: 'cashc',
    version: '0.14.0',
    options: {
      enforceFunctionParameterTypes: true,
      enforceLocktimeGuard: true,
    },
  },
  updatedAt: '2026-11-15T07:55:18.902Z',
} as const;
