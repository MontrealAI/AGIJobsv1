require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

const { MNEMONIC, RPC_MAINNET, RPC_SEPOLIA, ETHERSCAN_API_KEY } = process.env;

const mocha = { timeout: 600000 };

if (process.env.REPORT_GAS === 'true') {
  mocha.reporter = 'eth-gas-reporter';
  mocha.reporterOptions = {
    currency: 'USD',
    gasPrice: 30,
    noColors: true,
    showTimeSpent: true,
    excludeContracts: ['Migrations'],
  };
}

module.exports = {
  plugins: ['truffle-plugin-verify', 'truffle-hardhat-coverage'],
  api_keys: { etherscan: ETHERSCAN_API_KEY },
  networks: {
    development: { host: '127.0.0.1', port: 8545, network_id: '*' },
    sepolia: {
      provider: () => new HDWalletProvider(MNEMONIC, RPC_SEPOLIA),
      network_id: 11155111,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    },
    mainnet: {
      provider: () => new HDWalletProvider(MNEMONIC, RPC_MAINNET),
      network_id: 1,
      confirmations: 3,
      timeoutBlocks: 500,
      skipDryRun: true
    }
  },
  compilers: {
    solc: {
      version: '0.8.23',
      settings: { optimizer: { enabled: true, runs: 600 } }
    }
  },
  mocha
};
