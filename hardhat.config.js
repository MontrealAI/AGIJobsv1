require('dotenv').config();
require('@nomiclabs/hardhat-truffle5');
require('solidity-coverage');
require('./tasks/jobRegistry');
require('./tasks/feePool');
require('./tasks/stakeManager');
require('./tasks/identityRegistry');
require('./tasks/disputeModule');
require('./tasks/validationModule');

const { MNEMONIC, RPC_SEPOLIA, RPC_MAINNET } = process.env;

const mnemonicAccounts = MNEMONIC
  ? {
      mnemonic: MNEMONIC,
    }
  : undefined;

module.exports = {
  solidity: {
    version: '0.8.23',
    settings: {
      optimizer: { enabled: true, runs: 600 },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: false,
    },
    sepolia: {
      url: RPC_SEPOLIA || '',
      accounts: mnemonicAccounts,
    },
    mainnet: {
      url: RPC_MAINNET || '',
      accounts: mnemonicAccounts,
    },
  },
  mocha: {
    timeout: 600000,
  },
};
