require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

const { MNEMONIC, RPC_MAINNET, RPC_SEPOLIA, ETHERSCAN_API_KEY } = process.env;
const GANACHE_PORT = Number(process.env.GANACHE_PORT || 8545);

module.exports = {
  plugins: ['truffle-plugin-verify', 'solidity-coverage'],
  api_keys: { etherscan: ETHERSCAN_API_KEY },
  networks: {
    development: { host: '127.0.0.1', port: GANACHE_PORT, network_id: '*' },
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
      version: '0.8.20',
      settings: { optimizer: { enabled: true, runs: 600 } }
    }
  },
  mocha: { timeout: 600000 }
};
